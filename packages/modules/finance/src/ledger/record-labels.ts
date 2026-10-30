import { resolveRecordLabel, type CallContext, type Deps, type RecordLabelInput } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { requireFinanceRead, requireMasterDataRead } from './access';
import { taxPeriodInternal } from './tax-periods';
import { financeAccounts, financeCategories, financeConfirmations, financeEntries, financeFiscalYears, financePartnerProfiles, financePeriodEvents, financeDirectDebitRuns, financePurposes, financeReserves, financeFundsUseOpenings, financeSepaMandates, financeVatFilings } from '../schema';

const missing: RecordLabelInput = { label: '', href: null, state: 'missing' };
const forbiddenLabel: RecordLabelInput = { label: '', href: null, state: 'forbidden' };

/** Name je Typ: der Name aus der Tabelle, `undefined`, wenn der Datensatz fehlt. `master` = Stammdaten (auch `finance.overview`). */
const NAMES: Record<string, { master: boolean; read: (deps: Deps, id: string) => string | null | undefined }> = {
  financeAccount: { master: true, read: (deps, id) => deps.db.select({ name: financeAccounts.name }).from(financeAccounts).where(eq(financeAccounts.id, id)).get()?.name },
  financeCategory: { master: true, read: (deps, id) => deps.db.select({ name: financeCategories.name }).from(financeCategories).where(eq(financeCategories.id, id)).get()?.name },
  financePurpose: { master: true, read: (deps, id) => deps.db.select({ name: financePurposes.name }).from(financePurposes).where(eq(financePurposes.id, id)).get()?.name },
  financeReserve: { master: true, read: (deps, id) => deps.db.select({ name: financeReserves.name }).from(financeReserves).where(eq(financeReserves.id, id)).get()?.name },
  // M1: der Anfangsvortrag heißt nach seinem Entstehungsjahr.
  financeFundsUseOpening: { master: true, read: (deps, id) => deps.db.select({ designation: financeFundsUseOpenings.designation }).from(financeFundsUseOpenings).where(eq(financeFundsUseOpenings.id, id)).get()?.designation },
  // Ein Entwurf hat keine Nummer: dann nur die Art.
  financeEntry: { master: false, read: (deps, id) => { const row = deps.db.select({ number: financeEntries.number }).from(financeEntries).where(eq(financeEntries.id, id)).get(); return row ? (row.number ?? '') : undefined; } },
  financeConfirmation: { master: false, read: (deps, id) => deps.db.select({ number: financeConfirmations.documentNumber }).from(financeConfirmations).where(eq(financeConfirmations.id, id)).get()?.number },
  // L1: das Mandat heißt nach seiner Referenz.
  financeMandate: { master: false, read: (deps, id) => deps.db.select({ reference: financeSepaMandates.reference }).from(financeSepaMandates).where(eq(financeSepaMandates.id, id)).get()?.reference },
  // L2: der Einzug heißt nach seinem Fälligkeitstag (TT.MM.JJJJ).
  financeDirectDebitRun: { master: false, read: (deps, id) => { const day = deps.db.select({ day: financeDirectDebitRuns.collectionDate }).from(financeDirectDebitRuns).where(eq(financeDirectDebitRuns.id, id)).get()?.day; return day === undefined ? undefined : `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`; } },
};

/**
 * Beschriftung der Datensätze der Finanzen, vor allem für die Spalte „Objekt“ im Änderungsprotokoll (Joe 2026-10-09).
 * Namen stehen nur live da, mit Leserecht — gespeichert wird im Protokoll nie einer (Spec 10.3). `name` ist der bloße
 * Name, die Art setzt das Protokoll davor. Nicht aus `index.ts` exportieren (MCP-Paritätswächter).
 */
export function financeRecordLabels(deps: Deps, ctx: CallContext, entityType: string, id: string): RecordLabelInput | null {
  if (entityType === 'financeFiscalYear') return fiscalYearLabel(deps, ctx, id);
  if (entityType === 'financePeriodEvent') {
    const event = deps.db.select({ fiscalYearId: financePeriodEvents.fiscalYearId }).from(financePeriodEvents).where(eq(financePeriodEvents.id, id)).get();
    return event ? fiscalYearLabel(deps, ctx, event.fiscalYearId) : missing;
  }
  if (entityType === 'financeTaxPeriod') {
    // Rechenschaft D2: der Zeitraum heißt nach seinen Jahren („2023–2025“) — wie die Jahresbezeichnung verrät er nichts.
    const period = taxPeriodInternal(deps.db, id);
    if (!period) return missing;
    return { label: { key: 'finance.records.taxPeriod', params: { period: period.label } }, name: period.label, href: null, state: requireFinanceRead(ctx, 'overview') ? 'forbidden' : 'ok' };
  }
  if (entityType === 'financeVatFiling') {
    // E6b: die Abgabe heißt nach ihrem Zeitraum („2026-Q2“) — er verrät nichts.
    const period = deps.db.select({ period: financeVatFilings.period }).from(financeVatFilings).where(eq(financeVatFilings.id, id)).get()?.period;
    if (!period) return missing;
    return { label: { key: period.length === 4 ? 'finance.records.vatAnnualFiling' : 'finance.records.vatFiling', params: { period } }, name: period, href: null, state: requireFinanceRead(ctx, 'overview') ? 'forbidden' : 'ok' };
  }
  if (entityType === 'financePartnerProfile') {
    const row = deps.db.select({ contactId: financePartnerProfiles.contactId }).from(financePartnerProfiles).where(eq(financePartnerProfiles.id, id)).get();
    if (!row) return missing;
    if (requireFinanceRead(ctx, 'read')) return forbiddenLabel;
    // Der Name des Partners ist der seines Kontakts — nur mit dem Leserecht für Kontakte, wie beim Kontakt selbst.
    const contact = resolveRecordLabel(deps, ctx, 'contact', row.contactId);
    return contact?.state === 'ok' ? { label: contact.label, href: null, state: 'ok' } : forbiddenLabel;
  }
  const def = NAMES[entityType];
  if (!def) return null;
  const name = def.read(deps, id);
  if (name === undefined || name === null) return missing;
  const denied = def.master ? requireMasterDataRead(ctx).failure : requireFinanceRead(ctx, 'read');
  return denied ? forbiddenLabel : { label: name, href: null, state: 'ok' };
}

/** Das Label bleibt auch ohne Recht stehen — eine Jahresbezeichnung verrät nichts. */
function fiscalYearLabel(deps: Deps, ctx: CallContext, id: string): RecordLabelInput {
  const year = deps.db.select({ designation: financeFiscalYears.designation }).from(financeFiscalYears).where(eq(financeFiscalYears.id, id)).get();
  if (!year) return missing;
  const denied = requireFinanceRead(ctx, 'overview');
  return { label: { key: 'finance.records.fiscalYear', params: { designation: year.designation } }, name: year.designation, href: null, state: denied ? 'forbidden' : 'ok' };
}
