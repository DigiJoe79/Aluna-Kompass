import { completeFollowUpsInternal, createFollowUpInternal, isModuleEnabled, isoNow, newId, notFound, notifyFollowUpAssignee, ok, paperDate, publishedItemLiveSince, readSetting, requirePermission, schema as coreSchema, timeZoneOf, todayIn, validate, type CallContext, type DbOrTx, type Deps, type FollowUpRecord, type IsoDay, type Result } from '@kompass/core';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { assemblyOfYearInternal } from './assembly';
import { financeConflict, requireHumanChannelFinance } from '../errors';
import type { PeriodReopenGuard } from '../locks';
import { financeAnnualAccountsPublications, financeFiscalYears, financeReports, type FinanceAnnualAccountsPublicationRow } from '../schema';
import { contactTaxDetailsInternal } from '../allocation/contact-tax-details';
import { nameConsentValidInternal } from '../allocation/name-consents';

const isLegalEntityInternal = (db: DbOrTx, contactId: string) => contactTaxDetailsInternal(db, contactId)?.legalEntity === 'yes';
import { zonedDayOf } from '../zoned-days';
import { assemblyOnInternal, documentEndInternal, loadAnnualAccountsVersionInternal, renderAnnualAccountsVersionInternal, signatureRowInternal } from './annual-accounts-sign';
import type { AnnualAccountsAnnex } from '../reporting/types';

export type AnnualAccountsEarlyReason = 'itzDeadline' | 'funderRequest' | 'other';
export type AnnualAccountsWithdrawnCause = 'manual' | 'voided' | 'renderFailed';

/** Eine Veröffentlichung, wie Oberfläche und MCP sie sehen (J2). `liveSince`: seit wann sie so auf der Webseite steht. */
export interface AnnualAccountsPublicationView {
  id: string;
  reportId: string;
  fiscalYearId: string;
  publishedAt: string;
  earlyReason: AnnualAccountsEarlyReason | null;
  corrected: boolean;
  replacesFinalizedAt: string | null;
  webVersionOn: string | null;
  withdrawnAt: string | null;
  withdrawnCause: AnnualAccountsWithdrawnCause | null;
  /** Zurückgenommen: seit wann sie da auf der Webseite stand; `null`, wenn sie nur bereitgestellt war. */
  withdrawnLiveSince: string | null;
  liveSince: string | null;
}

/** Adresse der Jahresrechnung eines Jahres in Kompass — zugleich der Schlüssel ihrer Zeile in der Sicht (`editLink`). */
export const annualAccountsHref = (fiscalYearId: string) => `/finance/reports/annualAccounts?year=${fiscalYearId}`;

export function publicationViewInternal(deps: Deps, row: FinanceAnnualAccountsPublicationRow): AnnualAccountsPublicationView {
  return {
    id: row.id,
    reportId: row.reportId,
    fiscalYearId: row.fiscalYearId,
    publishedAt: row.publishedAt,
    earlyReason: row.earlyReason,
    corrected: row.corrected,
    replacesFinalizedAt: row.replacesFinalizedAt,
    webVersionOn: row.webVersionOn,
    withdrawnAt: row.withdrawnAt,
    withdrawnCause: row.withdrawnCause,
    withdrawnLiveSince: row.withdrawnLiveSince,
    liveSince: row.withdrawnAt ? null : publishedItemLiveSince(deps, 'annualAccounts', annualAccountsHref(row.fiscalYearId)),
  };
}

/** Die laufende Veröffentlichung einer Fassung, sonst `null`. */
export function livePublicationInternal(db: DbOrTx, reportId: string): FinanceAnnualAccountsPublicationRow | null {
  return db.select().from(financeAnnualAccountsPublications).where(and(eq(financeAnnualAccountsPublications.reportId, reportId), isNull(financeAnnualAccountsPublications.withdrawnAt))).get() ?? null;
}

/**
 * Die Veröffentlichungen eines Jahres, die öffentlich waren oder sind (Ve-L-3, Abnahme B1 Nachzug 4): zurückgenommen nur,
 * wenn sie da auf der Webseite stand (`withdrawnLiveSince`); laufend, wenn die Webseite sie ausliefert. Eine nur
 * bereitgestellte, still zurückgenommene zählt nicht — die nächste Fassung ist dann keine berichtigte.
 */
export function publicPublicationsOfYearInternal(deps: Deps, db: DbOrTx, fiscalYearId: string): FinanceAnnualAccountsPublicationRow[] {
  return publicationsOfYearInternal(db, fiscalYearId).filter((p) => (p.withdrawnAt ? p.withdrawnLiveSince !== null : publishedItemLiveSince(deps, 'annualAccounts', annualAccountsHref(p.fiscalYearId)) !== null));
}

/** Alle Veröffentlichungen eines Jahres, jüngste zuerst (auch zurückgenommene). */
export function publicationsOfYearInternal(db: DbOrTx, fiscalYearId: string): FinanceAnnualAccountsPublicationRow[] {
  return db.select().from(financeAnnualAccountsPublications).where(eq(financeAnnualAccountsPublications.fiscalYearId, fiscalYearId)).orderBy(desc(financeAnnualAccountsPublications.publishedAt), desc(financeAnnualAccountsPublications.id)).all();
}

/**
 * Zurücknehmen in der Transaktion des Aufrufers, mit Protokoll — von Hand, beim Storno oder wenn die Webfassung scheitert.
 * Hält fest, seit wann die Fassung auf der Webseite stand (`withdrawnLiveSince`); `null`, wenn sie nur bereitgestellt war.
 */
export function withdrawPublicationInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, row: FinanceAnnualAccountsPublicationRow, cause: AnnualAccountsWithdrawnCause): { liveSince: string | null } {
  const now = isoNow(deps.clock);
  const liveSince = publishedItemLiveSince(deps, 'annualAccounts', annualAccountsHref(row.fiscalYearId));
  tx.update(financeAnnualAccountsPublications).set({ withdrawnAt: now, withdrawnByUserId: ctx.userId ?? 'system', withdrawnCause: cause, withdrawnLiveSince: liveSince }).where(eq(financeAnnualAccountsPublications.id, row.id)).run();
  const year = tx.select({ designation: financeFiscalYears.designation }).from(financeFiscalYears).where(eq(financeFiscalYears.id, row.fiscalYearId)).get()!;
  const documentNumber = row.webDocumentNumber ?? signatureRowInternal(tx, row.reportId)?.documentNumber ?? '';
  financeAudit(tx, deps, ctx, { action: 'finance.annualAccounts.withdraw', entity: 'financeAnnualAccountsPublication', id: row.id, before: { withdrawnAt: null }, after: { reportId: row.reportId, withdrawnAt: now, withdrawnCause: cause, withdrawnLiveSince: liveSince }, params: { designation: year.designation, documentNumber } });
  return { liveSince };
}

/**
 * Wann gilt eine Veröffentlichung als „vor der MV“, wann ist sie gesperrt (Ve-L-1, Ve-L-3)? Für Dienst und Zustand
 * gleich. Berichtigt ist eine Fassung, wenn für das Jahr schon eine **andere** Fassung öffentlich war (auch
 * zurückgenommen, aber nicht nur bereitgestellt); dieselbe Fassung nach dem Zurücknehmen erneut folgt den gewöhnlichen
 * Regeln.
 */
export function publishNeedsInternal(deps: Deps, db: DbOrTx, fiscalYearId: string, reportId: string): { corrected: boolean; early: boolean; blocked: 'annualAccountsAssemblyPending' | null; assemblyOn: string | null } {
  const corrected = publicPublicationsOfYearInternal(deps, db, fiscalYearId).some((p) => p.reportId !== reportId);
  const assembly = assemblyOfYearInternal(deps, db, fiscalYearId, timeZoneOf(deps));
  const approves = readSetting<boolean>(deps, 'finance.reports.assemblyApprovesAccounts') === true;
  if (corrected) return { corrected, early: false, blocked: null, assemblyOn: assembly?.assemblyOn ?? null };
  if (assembly) return { corrected, early: false, blocked: approves && assembly.accountsApproved !== 'yes' ? 'annualAccountsAssemblyPending' : null, assemblyOn: assembly.assemblyOn };
  return { corrected, early: true, blocked: approves ? 'annualAccountsAssemblyPending' : null, assemblyOn: null };
}

/** Beide Rechte (Spec: Veröffentlichung ist Geschäftsführung des Vorstands, Ve-L-4) und ein Mensch. */
function requirePublishRights(deps: Deps, ctx: CallContext) {
  return requirePermission(ctx, 'finance.reportsFinalize') ?? requirePermission(ctx, 'site.publish') ?? requireHumanChannelFinance(deps, ctx);
}

const publishSchema = z
  .object({ reportId: z.string().min(1), earlyReason: z.enum(['itzDeadline', 'funderRequest', 'other']).optional(), earlyNote: z.string().trim().max(500).optional() })
  .superRefine((v, c) => {
    if (v.earlyReason === 'other' && !v.earlyNote) c.addIssue({ code: 'custom', path: ['earlyNote'], message: 'required' });
  });

/**
 * Die abgezeichnete Jahresrechnung für die Webseite bereitstellen (Spec Teil J „Veröffentlichen“): `finance.reportsFinalize`
 * **und** `site.publish`, humanOnly. Sichtbar wird sie mit dem nächsten Publizieren der Webseite. Vor dem MV-Ergebnis nur
 * mit Grund (`earlyReason`, bei `other` mit Notiz — nie im Protokoll); mit „MV genehmigt die Jahresrechnung“ erst nach
 * ihrem Beschluss. Gab es für das Jahr schon eine Veröffentlichung, ist es die berichtigte Fassung — ohne Grund (Ve-L-3).
 */
export async function publishAnnualAccounts(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AnnualAccountsPublicationView>> {
  const denied = requirePublishRights(deps, ctx);
  if (denied) return denied;
  const parsed = validate(deps, publishSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (!isModuleEnabled(deps, 'site')) return financeConflict('siteModuleDisabled');
  const loaded = loadAnnualAccountsVersionInternal(deps.db, v.reportId);
  if (!loaded.ok) return loaded;
  const { row, designation } = loaded.value;
  const signature = signatureRowInternal(deps.db, row.id);
  if (!signature) return financeConflict('annualAccountsNotSigned');
  if (livePublicationInternal(deps.db, row.id)) return financeConflict('annualAccountsAlreadyPublished');
  const needs = publishNeedsInternal(deps, deps.db, row.fiscalYearId, row.id);
  if (needs.blocked) return financeConflict(needs.blocked);
  if (needs.early && !v.earlyReason) return financeConflict('annualAccountsEarlyReasonRequired');
  const earlyReason = needs.early ? (v.earlyReason ?? null) : null;
  const previous = publicPublicationsOfYearInternal(deps, deps.db, row.fiscalYearId).find((p) => p.reportId !== row.id);
  const replaced = previous ? deps.db.select({ finalizedAt: financeReports.finalizedAt }).from(financeReports).where(eq(financeReports.id, previous.reportId)).get() : undefined;
  const replacesFinalizedAt = replaced?.finalizedAt ?? null;
  const insert = (tx: DbOrTx, web: { id: string; number: string; on: string } | null) => {
      const id = newId();
      tx.insert(financeAnnualAccountsPublications)
        .values({ id, reportId: row.id, fiscalYearId: row.fiscalYearId, publishedAt: isoNow(deps.clock), publishedByUserId: ctx.userId ?? 'system', earlyReason, earlyNote: earlyReason ? (v.earlyNote ?? null) : null, corrected: needs.corrected, replacesFinalizedAt, webDocumentId: web?.id ?? null, webDocumentNumber: web?.number ?? null, webVersionOn: web?.on ?? null })
        .run();
      financeAudit(tx, deps, ctx, {
        action: 'finance.annualAccounts.publish',
        entity: 'financeAnnualAccountsPublication',
        id,
        after: { reportId: row.id, fiscalYearId: row.fiscalYearId, earlyKind: earlyReason, corrected: needs.corrected },
        params: { designation, documentNumber: signature.documentNumber, early: earlyReason !== null, earlyKind: earlyReason, corrected: needs.corrected },
      });
      // Abnahme J2: Für das Jahr steht wieder eine gültige Fassung bereit — „Webseite neu publizieren“ ist erledigt.
      completeRepublishFollowUpsInternal(tx, deps, ctx, row.fiscalYearId, designation);
      return tx.select().from(financeAnnualAccountsPublications).where(eq(financeAnnualAccountsPublications.id, id)).get()!;
  };
  // Nennt die abgezeichnete Fassung jemanden, der seine Einwilligung inzwischen widerrufen hat, geht nie sie, sondern eine
  // Webfassung ohne den Namen auf die Webseite (etwa nach einer gescheiterten Webfassung erneut bereitgestellt).
  const web = webVersionAnnexInternal(deps, signature, row.fiscalYearId, Number(deps.db.select({ endsOn: financeFiscalYears.endsOn }).from(financeFiscalYears).where(eq(financeFiscalYears.id, row.fiscalYearId)).get()!.endsOn.slice(0, 4)), replacesFinalizedAt);
  try {
    if (web.needed) {
      const today = todayIn(deps);
      const rendered = await renderAnnualAccountsVersionInternal(deps, ctx, row.id, web.annex, `Webfassung vom ${paperDate(today as IsoDay)}`, (tx, doc) => insert(tx, { id: doc.id, number: doc.number, on: today }), web.keepOnly);
      if (!rendered.ok) return rendered;
      return ok(publicationViewInternal(deps, rendered.value.after!));
    }
    const created = deps.db.transaction((tx: DbOrTx) => insert(tx, null));
    return ok(publicationViewInternal(deps, created));
  } catch (error) {
    // Doppelklick, zweiter Reiter: der partielle Unique-Index „eine laufende je Fassung“.
    if (error instanceof Error && /UNIQUE constraint failed: finance_annual_accounts_publications/.test(error.message)) return financeConflict('annualAccountsAlreadyPublished');
    throw error;
  }
}

const reportIdSchema = z.object({ reportId: z.string().min(1) });

/** Von der Webseite nehmen (mit dem nächsten Publizieren): dieselben Rechte, humanOnly. Auch für eine stornierte Fassung. */
export async function withdrawAnnualAccounts(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AnnualAccountsPublicationView>> {
  const denied = requirePublishRights(deps, ctx);
  if (denied) return denied;
  const parsed = validate(deps, reportIdSchema, input);
  if (!parsed.ok) return parsed;
  const report = deps.db.select({ id: financeReports.id, reportKey: financeReports.reportKey }).from(financeReports).where(eq(financeReports.id, parsed.value.reportId)).get();
  if (!report || report.reportKey !== 'annualAccounts') return notFound('financeReport', parsed.value.reportId);
  const live = livePublicationInternal(deps.db, report.id);
  if (!live) return financeConflict('annualAccountsNotPublished');
  deps.db.transaction((tx: DbOrTx) => withdrawPublicationInternal(tx, deps, ctx, live, 'manual'));
  return ok(publicationViewInternal(deps, deps.db.select().from(financeAnnualAccountsPublications).where(eq(financeAnnualAccountsPublications.id, live.id)).get()!));
}

/** Titel der Wiedervorlage, wenn die Webseite eine Jahresrechnung neu braucht (Storno, Webfassung nach Widerruf). */
export const republishFollowUpTitle = (designation: string) => `Webseite neu publizieren (Jahresrechnung ${designation})`;

/**
 * Widerruf einer Einwilligung (Ve-F-2, Art. 7 Abs. 3 DSGVO): Für jede laufende Veröffentlichung einer nicht stornierten
 * Fassung, deren abgezeichnete Fassung den Kontakt in F8 nennt, entsteht eine **Webfassung** ohne die Namen aller
 * inzwischen widerrufenen Genannten (gleiche Zahlen, Vermerk „Fassung vom … für die Webseite“); festgeschriebene und
 * abgezeichnete Fassung bleiben unverändert. Danach die Wiedervorlage „Webseite neu publizieren“ an die Person, die
 * veröffentlicht hat (Mail, wenn das nicht die erfassende ist). Scheitert das Rendern, fällt die Zeile aus der Sicht
 * (`renderFailed`, nie der alte Name), die Wiedervorlage entsteht trotzdem. Läuft nach der Transaktion des Widerrufs
 * (Haken `registerNameConsentRevokedHook`) und wirft nie; die Akte bekommt das Recht nur für diesen Aufruf.
 */
export async function refreshAnnualAccountsWebVersionsInternal(deps: Deps, ctx: CallContext, contactId: string): Promise<{ refreshed: number; failed: number }> {
  const result = { refreshed: 0, failed: 0 };
  const live = deps.db
    .select({ pub: financeAnnualAccountsPublications, report: financeReports, year: financeFiscalYears })
    .from(financeAnnualAccountsPublications)
    .innerJoin(financeReports, eq(financeReports.id, financeAnnualAccountsPublications.reportId))
    .innerJoin(financeFiscalYears, eq(financeFiscalYears.id, financeAnnualAccountsPublications.fiscalYearId))
    .where(and(isNull(financeAnnualAccountsPublications.withdrawnAt), isNull(financeReports.voidedAt)))
    .all();
  const today = todayIn(deps);
  for (const { pub, report, year } of live) {
    const signature = signatureRowInternal(deps.db, report.id);
    if (!signature) continue;
    const named = JSON.parse(signature.namedContactIds) as string[];
    const yearNumber = Number(year.endsOn.slice(0, 4));
    // Nur, wenn diese Fassung den Kontakt nennt und er heute keine geltende Einwilligung mehr hat; anonymisiert werden
    // dann alle Genannten ohne geltende Einwilligung (auch frühere Widerrufe). Juristische Personen widerrufen nicht.
    if (!named.includes(contactId) || nameConsentValidInternal(deps.db, contactId, yearNumber, today)) continue;
    const { annex, keepOnly } = webVersionAnnexInternal(deps, signature, report.fiscalYearId, yearNumber, pub.replacesFinalizedAt);
    let followUp: FollowUpRecord | null = null;
    const assignee = deps.db.select({ id: coreSchema.users.id }).from(coreSchema.users).where(eq(coreSchema.users.id, pub.publishedByUserId)).get()?.id ?? null;
    const addFollowUp = (tx: DbOrTx) => {
      followUp = createFollowUpInternal(tx, deps, ctx, { entityType: 'financeFiscalYear', entityId: report.fiscalYearId, dueAt: today, title: republishFollowUpTitle(year.designation), assigneeUserId: assignee });
    };
    try {
      const rendered = await renderAnnualAccountsVersionInternal(deps, ctx, report.id, annex, `Webfassung vom ${paperDate(today as IsoDay)}`, (tx, doc) => {
        tx.update(financeAnnualAccountsPublications).set({ webDocumentId: doc.id, webDocumentNumber: doc.number, webVersionOn: today }).where(eq(financeAnnualAccountsPublications.id, pub.id)).run();
        // Eine ältere Wiedervorlage des Jahres (etwa nach einer gescheiterten Webfassung) ist mit dieser erledigt.
        completeRepublishFollowUpsInternal(tx, deps, ctx, report.fiscalYearId, year.designation);
        financeAudit(tx, deps, ctx, { action: 'finance.annualAccounts.webVersion', entity: 'financeAnnualAccountsPublication', id: pub.id, after: { reportId: report.id, webDocumentNumber: doc.number, webVersionOn: today }, params: { designation: year.designation, documentNumber: doc.number } });
        addFollowUp(tx);
      }, keepOnly);
      if (!rendered.ok) throw new Error(`Webfassung der Jahresrechnung ${year.designation}: ${rendered.error.type}`);
      result.refreshed += 1;
    } catch (error) {
      console.error('[finance] Webfassung der Jahresrechnung nicht erzeugt', error);
      // Nie den alten Namen auf der Webseite: die Zeile fällt aus der Sicht.
      deps.db.transaction((tx: DbOrTx) => {
        const fresh = tx.select().from(financeAnnualAccountsPublications).where(eq(financeAnnualAccountsPublications.id, pub.id)).get()!;
        if (!fresh.withdrawnAt) withdrawPublicationInternal(tx, deps, ctx, fresh, 'renderFailed');
        addFollowUp(tx);
      });
      result.failed += 1;
    }
    if (followUp) await notifyFollowUpAssignee(deps, ctx, followUp);
  }
  return result;
}

/**
 * Anhang und Namensliste einer Webfassung: Genannt bleibt nur, wer in der abgezeichneten Fassung genannt ist **und** zum
 * Tag der Webfassung noch eine geltende Einwilligung hat (juristische Personen immer) — Namen fallen weg, nie kommen welche
 * hinzu. `needed`: ob die abgezeichnete Fassung jemanden nennt, der heute nicht mehr genannt werden darf.
 */
function webVersionAnnexInternal(deps: Deps, signature: { signerName: string; signerOffice: string | null; signedOn: string; via: 'account' | 'scan'; scanDocumentId: string | null; namedContactIds: string }, fiscalYearId: string, yearNumber: number, replacesFinalizedAt: string | null): { annex: AnnualAccountsAnnex; keepOnly: string[]; needed: boolean } {
  const today = todayIn(deps);
  const named = JSON.parse(signature.namedContactIds) as string[];
  const keepOnly = named.filter((id) => isLegalEntityInternal(deps.db, id) || nameConsentValidInternal(deps.db, id, yearNumber, today));
  const annex: AnnualAccountsAnnex = {
    signature: { name: signature.signerName, office: signature.signerOffice, signedOn: signature.signedOn, via: signature.via, scanNumber: signature.scanDocumentId ? documentEndInternal(deps.db, signature.scanDocumentId).number : null },
    assemblyOn: assemblyOnInternal(deps, fiscalYearId),
    replacesFinalizedOn: replacesFinalizedAt ? zonedDayOf(replacesFinalizedAt, timeZoneOf(deps)) : null,
    webVersionOn: today,
    anonymize: named.filter((id) => !keepOnly.includes(id)),
  };
  return { annex, keepOnly, needed: keepOnly.length < named.length };
}

/** Offene Wiedervorlagen „Webseite neu publizieren“ eines Jahres erledigen (in der Transaktion des Aufrufers). */
function completeRepublishFollowUpsInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, fiscalYearId: string, designation: string): number {
  return completeFollowUpsInternal(tx, deps, ctx, { entityType: 'financeFiscalYear', entityId: fiscalYearId, titlePrefix: republishFollowUpTitle(designation) });
}

function livePublicationsOfYear(db: DbOrTx, yearId: string) {
  return db.select().from(financeAnnualAccountsPublications).where(and(eq(financeAnnualAccountsPublications.fiscalYearId, yearId), isNull(financeAnnualAccountsPublications.withdrawnAt))).all();
}
const designationOf = (db: DbOrTx, yearId: string) => db.select({ designation: financeFiscalYears.designation }).from(financeFiscalYears).where(eq(financeFiscalYears.id, yearId)).get()?.designation ?? '';

/**
 * Jahresrechnung (J2, Ve-F-4): Wiederöffnen storniert die Fassung (`reportsReopenGuard`) — eine veröffentlichte nimmt es
 * sofort aus der Sicht (Grund `voided`), nicht erst nach einer neuen Abzeichnung. Stand sie auf der Webseite, legt es die
 * fällige Wiedervorlage „Webseite neu publizieren“ an, zugewiesen an die Person, die wieder öffnet (an sich selbst: keine
 * Mail); war sie nur bereitgestellt, wird die Bereitstellung still zurückgenommen (Bildabnahme 0.4.5 F-2).
 */
export const annualAccountsReopenGuard: PeriodReopenGuard = {
  describe(db, yearId, deps) {
    if (livePublicationsOfYear(db, yearId).length === 0) return null;
    const online = deps ? publishedItemLiveSince(deps, 'annualAccounts', annualAccountsHref(yearId)) !== null : true;
    return { code: online ? 'annualAccountsWithdrawn' : 'annualAccountsProvisionRetracted', params: { designation: designationOf(db, yearId) } };
  },
  onReopen(tx, deps, ctx, yearId) {
    const live = livePublicationsOfYear(tx, yearId);
    if (live.length === 0) return;
    const wasLive = live.map((row) => withdrawPublicationInternal(tx, deps, ctx, row, 'voided').liveSince !== null).some(Boolean);
    if (!wasLive) return;
    createFollowUpInternal(tx, deps, ctx, { entityType: 'financeFiscalYear', entityId: yearId, dueAt: todayIn(deps), title: republishFollowUpTitle(designationOf(tx, yearId)), assigneeUserId: ctx.userId });
  },
};
