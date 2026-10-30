import { hasPermission, ok, readSetting, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { financeConflict } from '../errors';
import { requireFinanceRead } from '../ledger/access';
import { financeAnnualAccountsPublications, financeReports, financeReportSignatures } from '../schema';
import { REPORT_CATALOG, reportDefinition } from './catalog';
import { reportHash } from './hash';
import { countFinanceLinesInternal } from './lines';
import { canonicalJson } from './hash';
import { missingStatementPdfsInternal } from '../ledger/statement-documents';
import { releaseAuditInternal, releaseFollowUpInternal, type ReleaseAuditFacts } from '../locks';
import { finalizeBlockInternal, releaseChangeableInternal, releaseOfYearInternal, reportStageInternal, reportYearsInternal } from './stage';
import type { ReportComputeEnv, ReportDefinition, ReportFinalVersion, ReportListItem, ReportParams, ReportRelease, ReportRun, ReportVersionCopy, ReportVersionView } from './types';

/**
 * Der Verteiler (Spec § A „Mechanik“, Finanz-Spec § 9.1): ein Dienst für alle Berichte des Katalogs. Rechte nach
 * Personenbezug (`finance.read` mit, `finance.overview` ohne), Stufe und Hash aus dem Zustand.
 */

const runSchema = z.object({ report: z.string().min(1), params: z.record(z.string(), z.unknown()).default({}) });

export type ResolvedReport = { def: ReportDefinition; params: ReportParams };

/** Bericht und Parameter auflösen und das Leserecht prüfen — gemeinsam für Lauf, Vorschau und Festschreiben. */
export function resolveReportInternal(deps: Deps, ctx: CallContext, input: unknown): Result<ResolvedReport> {
  // Erst das Recht, dann die Eingabe (AGENTS.md): ohne jedes Finanz-Leserecht verrät der Dienst nicht, welche Berichte es gibt.
  const noRead = requireFinanceRead(ctx, 'overview');
  if (noRead) return noRead;
  const parsed = validate(deps, runSchema, input);
  if (!parsed.ok) return parsed;
  const def = reportDefinition(parsed.value.report);
  if (!def) return financeConflict('reportUnknown');
  if (!def.available) return financeConflict('reportUnavailable');
  const denied = requireFinanceRead(ctx, def.personal ? 'read' : 'overview');
  if (denied) return denied;
  const params = validate(deps, def.paramsSchema, parsed.value.params);
  if (!params.ok) return params;
  const problem = def.checkParams?.(deps.db, params.value);
  if (problem) return problem;
  return ok({ def, params: params.value });
}

/** Die Einstellungen, die der Bericht in `settingKeys` nennt — sonst keine. */
export function reportComputeEnvInternal(deps: Deps, def: ReportDefinition<unknown>): ReportComputeEnv {
  return { settings: Object.fromEntries((def.settingKeys ?? []).map((key) => [key, readSetting(deps, key)])) };
}

/** Rechnen, hashen, Stufe ableiten — ohne Rechteprüfung. `db` darf eine Transaktion sein; Einstellungen kommen über `deps`. */
export function runReportInternal<D>(deps: Deps, db: DbOrTx, def: ReportDefinition<D>, params: ReportParams): ReportRun<D> {
  const data = def.compute(db, params, reportComputeEnvInternal(deps, def as ReportDefinition<unknown>));
  const { hash, shortHash } = reportHash(def.key, params, data);
  const today = todayIn(deps);
  const stage = reportStageInternal(db, def as ReportDefinition, params, hash, today);
  const latest = reportYearsInternal(db, def as ReportDefinition, params).at(-1);
  const released = latest ? (releaseOfYearInternal(db, latest.id)?.basis ?? null) : null;
  const finalizeBlock = finalizeBlockInternal(db, def as ReportDefinition, params, hash, data, today);
  const finalVersion = stage === 'final' ? finalVersionInternal(db, def.key, params, hash) : null;
  const confirmation = def.confirmToFinalize?.(data) ?? null;
  return { report: def.key, params, stage, hash, shortHash, data, released, finalizeBlock, confirmation, finalizable: def.finalizable !== false, empty: def.empty?.(data) ?? null, finalVersion };
}

/** Die nicht zurückgenommene Fassung mit Bericht, Parametern und Datenstand — die Quelle der Stufe `final`. */
export function finalVersionInternal(db: DbOrTx, key: string, params: ReportParams, hash: string): ReportFinalVersion | null {
  const row = db
    .select()
    .from(financeReports)
    .where(and(eq(financeReports.reportKey, key), eq(financeReports.params, canonicalJson(params)), eq(financeReports.dataHash, hash), isNull(financeReports.voidedAt)))
    .get();
  if (!row) return null;
  const signed = reportCopiesInternal(db, row.id).find((c) => c.kind === 'signed');
  return { reportId: row.id, finalizedAt: row.finalizedAt, documentId: row.documentId, documentNumber: row.documentNumber, shortHash: row.dataHash.slice(0, 8), signedCopy: signed ? { documentId: signed.documentId, documentNumber: signed.documentNumber } : null };
}

/**
 * Die weiteren Dokumente einer Fassung (Jahresrechnung, Bildabnahme 0.4.5 F-3): die abgezeichnete Fassung und jede
 * Webfassung ihrer Veröffentlichungen, in dieser Folge. Andere Berichte haben keine.
 */
export function reportCopiesInternal(db: DbOrTx, reportId: string): ReportVersionCopy[] {
  const signed = db.select().from(financeReportSignatures).where(eq(financeReportSignatures.reportId, reportId)).get();
  if (!signed) return [];
  const web = db
    .select({ documentId: financeAnnualAccountsPublications.webDocumentId, documentNumber: financeAnnualAccountsPublications.webDocumentNumber, on: financeAnnualAccountsPublications.webVersionOn })
    .from(financeAnnualAccountsPublications)
    .where(eq(financeAnnualAccountsPublications.reportId, reportId))
    .orderBy(financeAnnualAccountsPublications.publishedAt, financeAnnualAccountsPublications.id)
    .all()
    .flatMap((p): ReportVersionCopy[] => (p.documentId && p.documentNumber && p.on ? [{ kind: 'web', documentId: p.documentId, documentNumber: p.documentNumber, on: p.on }] : []));
  return [{ kind: 'signed', documentId: signed.documentId, documentNumber: signed.documentNumber, on: signed.signedOn }, ...web];
}

export async function runFinanceReport(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ReportRun>> {
  const resolved = resolveReportInternal(deps, ctx, input);
  if (!resolved.ok) return resolved;
  const { def, params } = resolved.value;
  const computed = runReportInternal(deps, deps.db, def, params);
  const full = def.decorateOutput ? { ...computed, data: def.decorateOutput(deps, computed.data) } : computed;
  const run = def.redactWithoutRead && !hasPermission(ctx, 'finance.read') ? { ...full, data: def.redactWithoutRead(deps, full.data) } : full;
  // Je Summe Anzahl und Filter für `finance_lines_list` — keine ID-Listen (Finanz-Spec § 9.1).
  const filters = def.linesFilter?.(run.data, params);
  if (!filters) return ok(run);
  const lines = Object.fromEntries(Object.entries(filters).map(([name, filter]) => [name, { count: countFinanceLinesInternal(deps.db, filter).total, filter }]));
  return ok({ ...run, lines });
}

const listSchema = z.object({ fiscalYearId: z.string().min(1) });

/**
 * Der Katalog für ein Geschäftsjahr: je Bericht Stufe und die festgeschriebenen Fassungen (auch stornierte).
 * Ohne `finance.read` fehlen die Berichte mit Personenbezug. Die Stufe rechnet mit den Parametern
 * `{ fiscalYearId }`; braucht ein Bericht mehr (Stichtag), folgt sie nur dem Jahr.
 */
export async function listFinanceReports(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ reports: ReportListItem[]; release: ReportRelease | null; releaseAudit: ReleaseAuditFacts | null; releaseChangeable: boolean; statementsMissing: { accountId: string; name: string }[]; followUp: 'unchanged' | 'changed' | null }>> {
  const denied = requireFinanceRead(ctx, 'overview');
  if (denied) return denied;
  const parsed = validate(deps, listSchema, input);
  if (!parsed.ok) return parsed;
  const fullReader = requireFinanceRead(ctx, 'read') === null;
  const { fiscalYearId } = parsed.value;

  // Ein Bericht über einen Umsatzsteuer-Zeitraum (E6b) hat seine eigene Seite und steht nicht je Jahr im Katalog.
  const reports = REPORT_CATALOG.filter((def) => !def.periodEnd && (fullReader || !def.personal)).map((def): ReportListItem => {
    // Ein Bericht über einen eigenen Zeitraum (Erklärungszeitraum, D2): Fassungen und Stufe zu dessen Parametern.
    const own = def.paramsForYear ? def.paramsForYear(deps.db, fiscalYearId) : undefined;
    const lastFinal = (own === undefined
      ? deps.db.select().from(financeReports).where(and(eq(financeReports.reportKey, def.key), eq(financeReports.fiscalYearId, fiscalYearId)))
      : deps.db.select().from(financeReports).where(and(eq(financeReports.reportKey, def.key), eq(financeReports.params, own === null ? '' : canonicalJson(own))))
    )
      .orderBy(desc(financeReports.finalizedAt))
      .all()
      .map((r) => ({ finalizedAt: r.finalizedAt, byUserId: r.finalizedByUserId, documentId: r.documentId, documentNumber: r.documentNumber, voided: r.voidedAt !== null }));
    const stage = !def.available ? null : own === null ? null : own !== undefined ? runReportInternal(deps, deps.db, def, own).stage : listStage(deps, def, fiscalYearId);
    return { key: def.key, group: def.group, personal: def.personal, available: def.available, orientation: def.orientation, stage, lastFinal };
  });
  // Je Aufruf, nicht je Bericht: die Freigabe gehört zum Jahr (Designer Runde 2, 11a).
  // Die Begründung ist Freitext: ohne `finance.read` fehlt sie (ledger/access.ts), auf Bildschirm und über MCP gleich.
  const release = releaseOfYearInternal(deps.db, fiscalYearId);
  // Designer Runde 8, 347: bei „Prüfbericht“ der Tag des geltenden Berichts und der bestätigten Nachprüfung.
  const releaseAudit = release?.basis === 'auditReport' ? releaseAuditInternal(deps.db, fiscalYearId) : null;
  return ok({ reports, release: release && !fullReader ? { ...release, note: null } : release, releaseAudit, releaseChangeable: releaseChangeableInternal(deps.db, fiscalYearId), statementsMissing: missingStatementPdfsInternal(deps.db, fiscalYearId), followUp: releaseFollowUpInternal(deps.db, fiscalYearId) });
}

/**
 * Die festgeschriebenen Fassungen eines Berichts mit genau diesen Parametern, neueste zuerst, auch zurückgenommene
 * (Tabelle „Festgeschriebene Fassungen“). Recht wie `runFinanceReport`.
 */
export async function listFinanceReportVersions(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ versions: ReportVersionView[] }>> {
  const resolved = resolveReportInternal(deps, ctx, input);
  if (!resolved.ok) return resolved;
  const { def, params } = resolved.value;
  // Der Grund einer Rücknahme ist Freitext (Wiederöffnen): nur mit `finance.read`.
  const fullReader = requireFinanceRead(ctx, 'read') === null;
  const versions = deps.db
    .select()
    .from(financeReports)
    .where(and(eq(financeReports.reportKey, def.key), eq(financeReports.params, canonicalJson(params))))
    .orderBy(desc(financeReports.finalizedAt), desc(financeReports.id))
    .all()
    .map((r): ReportVersionView => ({
      reportId: r.id, finalizedAt: r.finalizedAt, byUserId: r.finalizedByUserId, shortHash: r.dataHash.slice(0, 8), documentId: r.documentId, documentNumber: r.documentNumber,
      releaseBasis: r.releaseBasis, voidedAt: r.voidedAt, voidReason: fullReader ? r.voidReason : null, replacedByReportId: r.replacedByReportId, copies: reportCopiesInternal(deps.db, r.id),
    }));
  return ok({ versions });
}

function listStage(deps: Deps, def: ReportDefinition, fiscalYearId: string): ReportListItem['stage'] {
  const db = deps.db;
  const params = def.paramsSchema.safeParse({ fiscalYearId });
  if (params.success) return runReportInternal(deps, db, def, params.data).stage;
  // Ein Bericht mit Pflichtparametern über das Jahr hinaus: Stufe nur aus dem Jahr (offen → vorläufig).
  return reportStageInternal(db, { ...def, years: () => [fiscalYearId], periodEnd: undefined }, { fiscalYearId }, '', todayIn(deps));
}
