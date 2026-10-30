import { formatTime, isoNow, nameOrEmpty, newId, notFound, ok, paperDate, readSetting, schema as coreSchema, requirePermission, timeZoneOf, todayIn, validate, buildContext, type CallContext, type DbOrTx, type Deps, type Failure, type Result } from '@kompass/core';
import { abortIssue, documentRelations, issueGeneratedDocument, readLinkedDocument, voidDocumentInternal } from '@kompass/module-dms';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { projects } from '@kompass/module-projects';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict, requireHumanChannelFinance } from '../errors';
import { FINAL_STAGE_NOTES, releaseFollowUpInternal } from '../locks';
import { requireFinanceRead } from '../ledger/access';
import { fiscalYearStatusInternal } from '../ledger/fiscal-years';
import { financeAccounts, financeCategories, financeFiscalYears, financeOtherAssets, financePurposes, financeReportReleases, financeReports, financeReserves } from '../schema';
import { canonicalJson } from './hash';
import { reportDefinition } from './catalog';
import { reportCopiesInternal, resolveReportInternal, runReportInternal } from './service';
import { linkVatFilingReportInternal } from './vat-filing';
import { finalizeBlockInternal, GROUPS_NEEDING_RELEASE, releaseChangeableInternal, releaseOfYearInternal, reportYearsInternal } from './stage';
import { buildReportDocument, REPORT_PERSONAL_TEMPLATE_KEY, REPORT_TEMPLATE_KEY, STAGE_TEXT, type ReportTemplateInput } from './template';
import { RELEASE_BASES, REPORT_CONFIRMATION_REASONS, type ReleaseBasis, type RenderOptions, type ReportDefinition, type ReportFinalizeBlock, type ReportParams, type ReportRenderContext, type ReportRun, type ReportStage } from './types';

/** Einstellungen, die das Papier braucht, als Beschriftung `setting.<name>` (Darstellung, nicht im Hash). */
const PAPER_SETTINGS = { statuteReference: 'finance.reports.statuteReference', cashReportSignature: 'finance.reports.cashReportSignature' } as const;

export function renderContextInternal(deps: Deps): ReportRenderContext {
  const db = deps.db;
  const leading = deps.locales()[0] ?? 'de';
  // F-B3: die Zone des Vereins für Tage aus Zeitstempeln auf dem Papier — Darstellung, die Zeitstempel selbst stehen im Hash.
  const settings = [...Object.entries(PAPER_SETTINGS).map(([name, key]) => [`setting.${name}`, String(readSetting<string | boolean>(deps, key))] as const), ['setting.timeZone', timeZoneOf(deps)] as const];
  return {
    categoryNames: Object.fromEntries(db.select({ id: financeCategories.id, name: financeCategories.name }).from(financeCategories).all().map((c) => [c.id, c.name])),
    accountNames: Object.fromEntries(db.select({ id: financeAccounts.id, name: financeAccounts.name }).from(financeAccounts).all().map((a) => [a.id, a.name])),
    // Namen aus dem Bestand, die nicht in die gehashten Daten gehören: frei getippte Bezeichnungen und Grundlagen des
    // sonstigen Vermögens (Designer 11h), Zwecke und Rücklagen. Die Texte des Papiers stehen in den Berichten selbst.
    labels: Object.fromEntries([
      ...db.select().from(financeOtherAssets).all().flatMap((a) => [[`otherAsset.${a.id}`, a.label], [`otherAssetBasis.${a.id}`, a.basis]]),
      ...db.select({ id: financePurposes.id, name: financePurposes.name }).from(financePurposes).all().map((p) => [`purpose.${p.id}`, p.name]),
      ...db.select({ id: financeReserves.id, name: financeReserves.name }).from(financeReserves).all().map((r) => [`reserve.${r.id}`, r.name]),
      // Projekte in der Leitsprache wie die übrigen Projektnamen der Finanzen; Nutzer mit Anzeigenamen (Übergabeliste).
      ...db.select({ id: projects.id, name: projects.name }).from(projects).all().map((p) => [`project.${p.id}`, nameOrEmpty((p.name as Record<string, string> | null)?.[leading])]),
      ...db.select({ id: coreSchema.users.id, name: coreSchema.users.name }).from(coreSchema.users).all().map((u) => [`user.${u.id}`, u.name]),
      ...settings,
    ]),
  };
}

/** „Geschäftsjahr 2025“, „Geschäftsjahre 2024–2025“; mit Stichtag dahinter. */
function subtitleOf(years: { designation: string }[], params: ReportParams, lead = '', period?: string): string {
  const span = period !== undefined ? period : years.length === 0 ? '' : years.length === 1 ? `Geschäftsjahr ${years[0]!.designation}` : `Geschäftsjahre ${years[0]!.designation}–${years.at(-1)!.designation}`;
  const day = params.date ? `Stichtag ${paperDate(params.date as never)}` : '';
  return [lead, span, day].filter(Boolean).join(' · ');
}

/**
 * Der Hinweis zur Stufe auf dem Papier; festgeschrieben nur, wenn die Freigabe kein Prüfbericht ist — oder ein Hinweis
 * des Jahres gilt (`FINAL_STAGE_NOTES`, Übernahme ins Folgejahr), der vor `finalizedAt` entstand. Berichte für die
 * Öffentlichkeit (`public`) tragen festgeschrieben keinen Vermerk.
 */
function stageTextOf(db: DbOrTx, def: ReportDefinition, stage: ReportStage, released: ReleaseBasis | null, years: readonly { id: string }[], finalizedAt: string | null): string {
  if (stage === 'preliminary') return STAGE_TEXT.preliminary;
  if (stage === 'review') return def.group === 'assembly' ? STAGE_TEXT.reviewAssembly : STAGE_TEXT.review;
  // Die Jahresrechnung (`public`) ist die Fassung für Mitglieder und Öffentlichkeit: kein Prüfvermerk im Kopf — weder die
  // Übernahme ins Folgejahr noch „ohne schriftlichen Prüfbericht“; F9 nennt die Prüfung mit festem Text je Begründung
  // (Bildabnahme 0.4.5 F-1, Abnahme B1 Nachzug 2). Gilt auch für ihre abgezeichnete und Webfassung (derselbe Weg).
  if (def.group === 'public') return '';
  const notes = finalizedAt === null ? [] : years.flatMap((y) => FINAL_STAGE_NOTES.map((note) => note(db, y.id))).filter((n): n is { text: string; since: string } => n !== null && n.since <= finalizedAt).map((n) => n.text);
  if (notes.length > 0) return [...new Set(notes)].join(' · ');
  return GROUPS_NEEDING_RELEASE.includes(def.group) && released !== null && released !== 'auditReport' ? STAGE_TEXT.finalWithoutAuditReport : '';
}

/** Wann die geltende Fassung mit genau diesem Datenstand festgeschrieben wurde — für die Vorschau einer `final`-Stufe. */
function finalizedAtOf(db: DbOrTx, def: ReportDefinition, run: ReportRun): string | null {
  return db.select({ at: financeReports.finalizedAt }).from(financeReports).where(and(eq(financeReports.reportKey, def.key), eq(financeReports.params, canonicalJson(run.params)), eq(financeReports.dataHash, run.hash), isNull(financeReports.voidedAt))).get()?.at ?? null;
}

/** „Erzeugt TT.MM.JJJJ, HH:MM · <Kurz-Hash>“ — Papierdatum und Uhrzeit in der Zone des Vereins, beim Aufruf (Spec § A). */
function footerNoteOf(deps: Deps, shortHash: string): string {
  return `Erzeugt ${paperDate(todayIn(deps))}, ${formatTime(isoNow(deps.clock), timeZoneOf(deps))} · ${shortHash}`;
}

/**
 * Was das Papier braucht: Titel, Untertitel, Körper, Stufe. Async, weil ein Bericht außerhalb des Hashs vorbereiten
 * kann (`prepareRender`, Jahresrechnung: Namensnennung zum Tag `opts.at`, Erläuterung als Typst, Anhang von J2).
 */
export async function documentInputInternal(deps: Deps, def: ReportDefinition, run: ReportRun, stage: ReportStage, finalizedAt: string | null = stage === 'final' ? finalizedAtOf(deps.db, def, run) : null, opts: RenderOptions = {}): Promise<ReportTemplateInput> {
  const years = reportYearsInternal(deps.db, def, run.params);
  const extra = def.prepareRender ? await def.prepareRender(deps, run.data, opts) : undefined;
  const ctx = { ...renderContextInternal(deps), ...(extra ? { extra } : {}) };
  return {
    title: def.paperTitle,
    subtitle: subtitleOf(years, run.params, def.paperSubtitle?.(ctx), def.paperPeriod?.(run.data)),
    typst: def.toTypst(run.data, ctx),
    stage,
    stageText: stageTextOf(deps.db, def, stage, run.released, years, finalizedAt),
    footerNote: footerNoteOf(deps, run.shortHash),
    orientation: def.orientation,
  };
}

const fileNameOf = (def: ReportDefinition, run: ReportRun) => `${def.paperTitle.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')}-${run.shortHash}.pdf`;

// ── Vorschau ────────────────────────────────────────────────────────────────

/**
 * Das PDF in der Stufe, die der Zustand ergibt — mit dem Leserecht des Berichts, nicht `humanOnly` (es ändert
 * nichts). Kein Akteneintrag, keine Nummer, kein Protokoll. Gerendert wird ohne `prepare`, weil dessen Prüfung das
 * Recht der Vorlage verlangt (`finance.reportsFinalize`) — die Vorschau braucht nur das Leserecht; die Basis wird wie
 * dort aufgelöst (`documents.bases` vor der Basis der Vorlage). Liefert Bytes: kein MCP-Werkzeug — ein Agent liest
 * die Daten über `finance_report`.
 */
export async function previewFinanceReport(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ bytes: Uint8Array; filename: string; stage: ReportStage; shortHash: string }>> {
  const resolved = resolveReportInternal(deps, ctx, input);
  if (!resolved.ok) return resolved;
  const { def, params } = resolved.value;
  const run = runReportInternal(deps, deps.db, def, params);
  const built = buildReportDocument(await documentInputInternal(deps, def, run, run.stage));
  const templateKey = def.personal ? REPORT_PERSONAL_TEMPLATE_KEY : REPORT_TEMPLATE_KEY;
  const baseId = readSetting<Record<string, string>>(deps, 'documents.bases')[templateKey] ?? built.base;
  if (!deps.documents.base(baseId)) return financeConflict('reportBaseUnavailable', { base: baseId });
  const context = await buildContext(deps, ctx, '');
  const { bytes } = await deps.documents.render({ baseId, bodyTypst: built.body.typst, slots: built.slots, context });
  return ok({ bytes, filename: fileNameOf(def, run), stage: run.stage, shortHash: run.shortHash });
}

// ── Festschreiben ───────────────────────────────────────────────────────────

/** Neben Bericht und Parametern: die Bestätigung, wenn der Bericht eine verlangt (`confirmToFinalize`). Sonstiges braucht Text. */
const finalizeExtraSchema = z.object({
  confirmation: z
    .object({ reason: z.enum(REPORT_CONFIRMATION_REASONS), note: z.string().trim().max(500).optional() })
    .superRefine((v, c) => {
      if (v.reason === 'other' && !v.note) c.addIssue({ code: 'custom', path: ['note'], message: 'required' });
    })
    .optional(),
});

/** Die Sperre als Ablehnung (Quelle: `finalizeBlockInternal`, dieselbe Prüfung wie am Lauf). */
function finalizeBlockerInternal(db: DbOrTx, def: ReportDefinition, params: ReportParams, hash: string, data: unknown, today: string) {
  const block = finalizeBlockInternal(db, def, params, hash, data, today);
  // Jeder Code der Sperre steht in `FINANCE_ERRORS` mit genau diesen Parametern; der Typ der Vereinigung verliert das.
  const refuse = financeConflict as (code: ReportFinalizeBlock['code'], params: ReportFinalizeBlock['params']) => Failure;
  return block ? refuse(block.code, block.params) : null;
}

/**
 * Festschreiben (Spec § A): `finance.reportsFinalize`, **`humanOnly`**. Das Jahr (alle Jahre des Berichts) ist
 * abgeschlossen; Berichte für MV, Prüfung und Arbeit brauchen die Freigabe des Jahres. Legt ein Dokument der Art
 * `finance-report` bzw. `finance-report-personal` an Bericht und Geschäftsjahr ab, Snapshot mit Parametern und Hash.
 * Eine ältere Fassung mit denselben Parametern und anderem Datenstand wird storniert und verweist auf die neue; ihr
 * Dokument bleibt lesbar. Eine schon stornierte Fassung (Wiederöffnen) bekommt die neue als Nachfolger. Gleicher Datenstand ein zweites Mal: `reportAlreadyFinal`.
 */
export async function finalizeFinanceReport(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ reportId: string; documentId: string; documentNumber: string; shortHash: string }>> {
  const denied = requirePermission(ctx, 'finance.reportsFinalize');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const resolved = resolveReportInternal(deps, ctx, input);
  if (!resolved.ok) return resolved;
  const { def, params } = resolved.value;
  // Die Bestätigung zählt nur bei Berichten, die eine verlangen können; sonst wird sie übergangen.
  let confirmation_: z.infer<typeof finalizeExtraSchema>['confirmation'];
  if (def.confirmToFinalize) {
    const extraInput = validate(deps, finalizeExtraSchema, input);
    if (!extraInput.ok) return extraInput;
    confirmation_ = extraInput.value.confirmation;
  }
  const run = runReportInternal(deps, deps.db, def, params);
  const blocked = finalizeBlockerInternal(deps.db, def, params, run.hash, run.data, todayIn(deps));
  if (blocked) return blocked;

  const years = reportYearsInternal(deps.db, def, params);
  const latest = years.at(-1)!;
  const reportId = newId();
  const paramsText = canonicalJson(params);
  // Planreview J1: eine verlangte Bestätigung (Vergütung ohne Grundlage) mit Begründung — keine Sperre.
  const need = def.confirmToFinalize?.(run.data) ?? null;
  const confirmation = need ? (confirmation_ ?? null) : null;
  if (need && !confirmation) return (financeConflict as (code: string, params: Record<string, string | number>) => Failure)(need.code, need.params);
  const finalizeConfirmation = need && confirmation ? canonicalJson({ code: need.code, reason: confirmation.reason, note: confirmation.note ?? null }) : null;
  const documentInput = await documentInputInternal(deps, def, run, 'final', isoNow(deps.clock));

  const issued = await issueGeneratedDocument(deps, ctx, {
    templateKey: def.personal ? REPORT_PERSONAL_TEMPLATE_KEY : REPORT_TEMPLATE_KEY,
    input: documentInput,
    snapshot: { report: def.key, params, dataHash: run.hash },
    // Ein Bericht über einen eigenen Zeitraum (Voranmeldung) nennt den Zeitraum, nicht das Geschäftsjahr.
    subject: `${def.paperTitle} ${def.periodEnd && def.paperPeriod ? def.paperPeriod(run.data) : years.length > 1 ? `${years[0]!.designation}–${latest.designation}` : latest.designation}`,
    documentDate: todayIn(deps),
    links: [{ entityType: 'financeReport', entityId: reportId }, ...years.map((y) => ({ entityType: 'financeFiscalYear', entityId: y.id }))],
    afterIssue: (tx, doc) => {
      // Zwischen Rendern und Transaktion vergeht Zeit: Datenstand, Jahr und Freigabe erneut prüfen (Muster issue.ts).
      const fresh = runReportInternal(deps, tx, def, params);
      if (fresh.hash !== run.hash) return abortIssue(financeConflict('reportDataChanged'));
      const again = finalizeBlockerInternal(tx, def, params, run.hash, fresh.data, todayIn(deps));
      if (again) return abortIssue(again);
      const now = isoNow(deps.clock);
      tx.insert(financeReports)
        .values({ id: reportId, reportKey: def.key, params: paramsText, fiscalYearId: latest.id, dataHash: run.hash, documentId: doc.id, documentNumber: doc.number, releaseBasis: GROUPS_NEEDING_RELEASE.includes(def.group) ? (releaseOfYearInternal(tx, latest.id)?.basis ?? null) : null, finalizedAt: now, finalizedByUserId: ctx.userId ?? 'system', voidedAt: null, voidReason: null, replacedByReportId: null, finalizeConfirmation })
        .run();
      financeAudit(tx, deps, ctx, { action: 'finance.report.finalize', entity: 'financeReport', id: reportId, after: { reportKey: def.key, fiscalYearId: latest.id, dataHash: run.hash, documentNumber: doc.number }, params: { reportKey: def.key, documentNumber: doc.number, confirmation: confirmation?.reason ?? null } });
      // Die ältere Fassung derselben Parameter (anderer Datenstand) wird ersetzt: storniert mit Verweis, lesbar.
      const older = tx.select().from(financeReports).where(and(eq(financeReports.reportKey, def.key), eq(financeReports.params, paramsText), isNull(financeReports.voidedAt))).all().filter((r) => r.id !== reportId);
      for (const old of older) voidReportInternal(tx, deps, ctx, old.id, `Ersetzt durch ${doc.number}`, reportId);
      // E6b: eine Abgabe ohne Fassung mit unverändertem Datenstand bekommt diese Fassung (Joe 2026-10-25, Frage 1).
      linkVatFilingReportInternal(tx, def.key, params, reportId);
      // Eine schon vorher ungültige Fassung (beim Wiederöffnen storniert) bekommt die neue als Nachfolger — die jüngste
      // ohne Nachfolger, einmal (Befund MCP 7; der Trigger lässt nur das Setzen von leer zu).
      const orphan = tx.select().from(financeReports).where(and(eq(financeReports.reportKey, def.key), eq(financeReports.params, paramsText), isNotNull(financeReports.voidedAt), isNull(financeReports.replacedByReportId))).orderBy(desc(financeReports.finalizedAt), desc(financeReports.id)).get();
      if (orphan) tx.update(financeReports).set({ replacedByReportId: reportId }).where(eq(financeReports.id, orphan.id)).run();
      return { reportId, documentId: doc.id, documentNumber: doc.number };
    },
  });
  if (!issued.ok) return issued;
  return ok({ ...issued.value.after!, shortHash: run.shortHash });
}

/**
 * Eine festgeschriebene Fassung stornieren — beim Ersetzen und beim Wiederöffnen (`locks.ts`). Ohne Rechteprüfung;
 * der Grund steht an Zeile und Dokument, nie im Protokoll.
 */
export function voidReportInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, reportId: string, reason: string, replacedByReportId: string | null = null): void {
  const row = tx.select().from(financeReports).where(eq(financeReports.id, reportId)).get();
  if (!row || row.voidedAt) return;
  const now = isoNow(deps.clock);
  tx.update(financeReports).set({ voidedAt: now, voidReason: reason, replacedByReportId }).where(eq(financeReports.id, reportId)).run();
  const voided = voidDocumentInternal(tx, deps, ctx, { id: row.documentId, reason });
  // Ein schon storniertes Dokument (von Hand in der Akte) hält das Storno der Fassung nicht auf.
  if (!voided.ok && voided.error.type !== 'conflict') throw new Error(`Bericht ${row.documentNumber}: Dokument nicht stornierbar`);
  // J2 (Abnahme): Was an der Fassung hängt — abgezeichnete Fassung, unterschriebener Scan, Webfassungen (Bezug
  // `signedCopyOf`) —, bleibt nicht als ausgestellt stehen: dasselbe Storno mit demselben Grund.
  for (const copy of tx.select({ id: documentRelations.documentId }).from(documentRelations).where(and(eq(documentRelations.relatedDocumentId, row.documentId), eq(documentRelations.kind, 'signedCopyOf'))).all()) {
    const done = voidDocumentInternal(tx, deps, ctx, { id: copy.id, reason });
    if (!done.ok && done.error.type !== 'conflict') throw new Error(`Bericht ${row.documentNumber}: Abschrift nicht stornierbar`);
  }
  financeAudit(tx, deps, ctx, { action: 'finance.report.void', entity: 'financeReport', id: reportId, before: { voidedAt: null }, after: { voidedAt: now }, params: { reportKey: row.reportKey, documentNumber: row.documentNumber } });
}

// ── Freigabe zum Festschreiben ──────────────────────────────────────────────

/** Die Gründe, die eine Begründung verlangen (Designer Runde 2, 11b: „Pflicht bei „Prüfung nicht erfolgt“ und „Sonstiges““). */
const NOTE_REQUIRED: readonly ReleaseBasis[] = ['notAudited', 'other'];

const releaseSchema = z
  .object({
    fiscalYearId: z.string().min(1),
    basis: z.enum(RELEASE_BASES),
    note: z.string().trim().max(1000).nullable().default(null),
    /** Bei `auditReport` Pflicht: der Scan in der Akte (Art `finance-audit-report`), aus der Akte oder hochgeladen. */
    documentId: z.string().min(1).nullable().optional(),
  })
  .refine((v) => !NOTE_REQUIRED.includes(v.basis) || (v.note !== null && v.note.length > 0), { path: ['note'], message: 'required' })
  .refine((v) => v.basis !== 'auditReport' || Boolean(v.documentId), { path: ['documentId'], message: 'required' });

/** Art des Scans eines schriftlichen Prüfberichts (Designer Runde 2, 11b). */
export const AUDIT_REPORT_TYPE_KEY = 'finance-audit-report';

/** Freigabe schreiben oder erneuern, mit Protokoll — ohne Rechteprüfung (D1 ruft mit `auditReport`). */
export function releaseReportsInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, input: { fiscalYearId: string; basis: ReleaseBasis; note: string | null; documentId?: string }): void {
  const year = tx.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, input.fiscalYearId)).get();
  if (!year) throw new Error(`Geschäftsjahr ${input.fiscalYearId} fehlt`);
  const now = isoNow(deps.clock);
  const row = { fiscalYearId: input.fiscalYearId, basis: input.basis, note: input.note, documentId: input.documentId ?? null, at: now, byUserId: ctx.userId ?? 'system', revokedAt: null, revokedByUserId: null };
  tx.insert(financeReportReleases).values(row).onConflictDoUpdate({ target: financeReportReleases.fiscalYearId, set: row }).run();
  financeAudit(tx, deps, ctx, { action: 'finance.report.release', entity: 'financeReportRelease', id: input.fiscalYearId, after: { fiscalYearId: input.fiscalYearId, basis: input.basis }, params: { designation: year.designation, basis: input.basis } });
}

/**
 * Berichte eines abgeschlossenen Jahres zum Festschreiben freigeben, ohne Prüfbericht mit bestätigter Begründung
 * (Spec § A): `finance.periodClose`, **`humanOnly`** — eine persönliche Erklärung. `other` braucht einen Freitext;
 * er steht an der Freigabe, nie im Protokoll.
 */
export async function releaseReportsForFinalizing(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ fiscalYearId: string; basis: ReleaseBasis }>> {
  const denied = requirePermission(ctx, 'finance.periodClose');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, releaseSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  // Rechenschaft D1: Der schriftliche Prüfbericht gibt frei, indem er abgelegt wird (`auditing/filing.ts`).
  if (v.basis === 'auditReport') return financeConflict('auditReportViaAudit');
  const year = deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, v.fiscalYearId)).get();
  if (!year) return notFound('financeFiscalYear', v.fiscalYearId);
  if (fiscalYearStatusInternal(deps.db, year.id) === 'open') return financeConflict('reportYearOpen', { designation: year.designation });
  if (releaseOfYearInternal(deps.db, year.id) && !releaseChangeableInternal(deps.db, year.id)) return financeConflict('releaseLocked', { designation: year.designation });
  // Eine offene Nachprüfung stellt die Freigabe über Schritt 10 wieder her — eine andere Grundlage umginge sie (279 Telefon).
  if (releaseFollowUpInternal(deps.db, year.id)) return financeConflict('releaseFollowUpOpen', { designation: year.designation });
  return deps.db.transaction((tx: DbOrTx) => {
    releaseReportsInternal(tx, deps, ctx, { fiscalYearId: year.id, basis: v.basis, note: v.note });
    return ok({ fiscalYearId: year.id, basis: v.basis });
  });
}

const reportDocumentSchema = z.object({ reportId: z.string().min(1), documentId: z.string().min(1).optional() });

/**
 * Die Datei einer festgeschriebenen Fassung, auch zurückgenommen — sie bleibt Beweismittel (Spec § A). Über den
 * Bezug `financeReport` als Berechtigung der Akte; mit Personenbezug braucht es `finance.read`. Liefert Bytes: kein
 * MCP-Werkzeug.
 */
export async function readFinanceReportDocument(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ bytes: Uint8Array; filename: string }>> {
  const noRead = requireFinanceRead(ctx, 'overview');
  if (noRead) return noRead;
  const parsed = validate(deps, reportDocumentSchema, input);
  if (!parsed.ok) return parsed;
  const row = deps.db.select().from(financeReports).where(eq(financeReports.id, parsed.value.reportId)).get();
  if (!row) return notFound('financeReport', parsed.value.reportId);
  const denied = requireFinanceRead(ctx, reportDefinition(row.reportKey)?.personal ? 'read' : 'overview');
  if (denied) return denied;
  // Mit `documentId` eine weitere Fassung desselben Berichts (abgezeichnet, Webfassung) — nie ein anderes Dokument.
  const documentId = parsed.value.documentId ?? row.documentId;
  if (documentId !== row.documentId && !reportCopiesInternal(deps.db, row.id).some((c) => c.documentId === documentId)) return notFound('document', documentId);
  const file = await readLinkedDocument(deps, ctx, { documentId, entityType: 'financeReport', entityId: row.id });
  if (!file.ok) return file;
  return ok({ bytes: file.value.bytes, filename: file.value.filename });
}

