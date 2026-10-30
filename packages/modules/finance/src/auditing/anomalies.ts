import { readSetting, timeZoneOf, type DbOrTx, type Deps } from '@kompass/core';
import { zonedDayOf, zonedDayRange } from '../zoned-days';
import { userLinkChangesInternal } from '@kompass/module-contacts';
import { and, asc, eq, gte, inArray, isNotNull, lt, lte } from 'drizzle-orm';
import { relatedPartyPaymentsInternal } from '../allocation/people';
import { firstNegativeCashDay } from '../ledger/cash-check';
import { valueAt } from '../ledger/dated-values';
import { accountBalancesAt } from '../ledger/queries';
import { reusedEvidenceInternal } from '../reporting/reused-evidence';
import {
  financeAccounts, financeAllocationCorrections, financeAllocationLines, financeCashCounts, financeCategories, financeEntries, financeFiscalYears, financeMoneyLines, financePartnerPayments, financePeriodEvents,
  type FinanceEntryRow, type FinanceFiscalYearRow,
} from '../schema';
import type { AuditSectionRow } from './sections';
import { carriedIntoYearInternal } from './carry-over';

/**
 * Auffälligkeiten des Prüfpakets (Finanz-Spec § 9.4): je `kind` die Zeilen mit den Werten ihrer Quelle. Hinweise, keine
 * Urteile — der Prüfer entscheidet, was er sich ansieht. Gruppiert nach `kind` in der Reihenfolge von `ANOMALY_KINDS`.
 */
export const ANOMALY_KINDS = [
  'relatedParty', 'cashPayout', 'roundAmount', 'cashDonation', 'reversal', 'correction', 'lateFinalized', 'cashShortfall', 'cashNegative',
  'partnerPaymentReason', 'evidenceReused', 'reopened', 'userLink', 'finalizedByAgent', 'priorYearCarryOver',
] as const;
export type AnomalyKind = (typeof ANOMALY_KINDS)[number];


function dayAfter(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Letzter Tag des Folgemonats eines Tages — Frist zum Festschreiben unbarer Buchungen. */
function endOfFollowingMonth(day: string): string {
  const d = new Date(`${day.slice(0, 7)}-01T00:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() + 2);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000);
}

const row = (kind: AnomalyKind, key: string, entry: Pick<FinanceEntryRow, 'id' | 'number' | 'entryDate'> | null, amountCents: number | null, labelParams: AuditSectionRow['labelParams'], date?: string): AuditSectionRow => ({
  key: `${kind}:${key}`, kind, ...(entry ? { entryId: entry.id } : {}), date: date ?? entry?.entryDate ?? null, amountCents, labelParams: { ...(entry ? { number: entry.number ?? '' } : {}), ...labelParams }, remarksOpen: 0,
});

export function anomalyRowsInternal(deps: Deps, year: FinanceFiscalYearRow): AuditSectionRow[] {
  // F-B3 (0.4.5): Zeitstempel zählen nach ihrem Tag in der Zone des Vereins, das Jahr über dessen Grenzen.
  const timeZone = timeZoneOf(deps);
  const dayOf = (iso: string) => zonedDayOf(iso, timeZone);
  const inYear = zonedDayRange(year.startsOn, year.endsOn, timeZone);
  const db: DbOrTx = deps.db;
  const entries = db.select().from(financeEntries).where(and(eq(financeEntries.fiscalYearId, year.id), eq(financeEntries.status, 'final'))).orderBy(asc(financeEntries.entryDate), asc(financeEntries.number)).all();
  const entryById = new Map(entries.map((e) => [e.id, e]));
  const ids = entries.map((e) => e.id);
  const cashIds = new Set(db.select({ id: financeAccounts.id }).from(financeAccounts).where(eq(financeAccounts.kind, 'cash')).all().map((a) => a.id));
  const money = ids.length ? db.select().from(financeMoneyLines).where(inArray(financeMoneyLines.entryId, ids)).all() : [];
  const allocation = ids.length
    ? db.select({ id: financeAllocationLines.id, entryId: financeAllocationLines.entryId, amountCents: financeAllocationLines.amountCents, direction: financeCategories.direction, incomeKind: financeCategories.incomeKind }).from(financeAllocationLines).innerJoin(financeCategories, eq(financeCategories.id, financeAllocationLines.categoryId)).where(inArray(financeAllocationLines.entryId, ids)).all()
    : [];
  const onCash = (entryId: string) => money.some((m) => m.entryId === entryId && cashIds.has(m.accountId));
  const out: Record<AnomalyKind, AuditSectionRow[]> = Object.fromEntries(ANOMALY_KINDS.map((k) => [k, []])) as never;

  // Zahlungen an Organmitglieder und Nahestehende, je mit Freigeber.
  const boardBasisFrom = readSetting<boolean>(deps, 'finance.boardRemunerationAllowed') ? readSetting<string | null>(deps, 'finance.boardRemunerationValidFrom') : null;
  for (const p of relatedPartyPaymentsInternal(db, { from: year.startsOn, to: year.endsOn, boardBasisFrom })) {
    const entry = entryById.get(p.entryId) ?? { id: p.entryId, number: p.entryNumber, entryDate: p.entryDate };
    out.relatedParty.push(row('relatedParty', `${p.entryId}:${p.contactId}:${p.role}`, entry, p.amountCents, { role: p.role, contactName: p.contactName, approvedByUserId: p.approvedByUserId, originKind: p.originKind, originNumber: p.originNumber }));
  }

  // Barauszahlungen.
  for (const m of money) if (cashIds.has(m.accountId) && m.amountCents < 0) out.cashPayout.push(row('cashPayout', m.id, entryById.get(m.entryId)!, m.amountCents, {}));

  // Runde Beträge bei Ausgaben.
  const roundFrom = readSetting<number>(deps, 'finance.roundAmountFromCents');
  for (const e of entries) {
    const expense = allocation.filter((a) => a.entryId === e.id && a.direction === 'expense').reduce((s, a) => s + a.amountCents, 0);
    if (expense !== 0 && Math.abs(expense) >= roundFrom && Math.abs(expense) % 10_000 === 0) out.roundAmount.push(row('roundAmount', e.id, e, expense, {}));
  }

  // Barspenden ab Schwelle.
  const cashAlert = readSetting<number>(deps, 'finance.cashDonationAlertCents');
  for (const a of allocation) if (a.incomeKind === 'donation' && a.amountCents >= cashAlert && onCash(a.entryId)) out.cashDonation.push(row('cashDonation', a.id, entryById.get(a.entryId)!, a.amountCents, {}));

  // Stornos.
  for (const e of entries) if (e.reversesEntryId) out.reversal.push(row('reversal', e.id, e, money.filter((m) => m.entryId === e.id).reduce((s, m) => s + m.amountCents, 0), { reversedNumber: db.select({ number: financeEntries.number }).from(financeEntries).where(eq(financeEntries.id, e.reversesEntryId)).get()?.number ?? '' }));

  // Zuordnungskorrekturen, im Jahr angewandt — auch an früheren Jahren.
  const corrections = db.select().from(financeAllocationCorrections).where(and(eq(financeAllocationCorrections.state, 'applied'), gte(financeAllocationCorrections.approvedAt, inYear.start), lt(financeAllocationCorrections.approvedAt, inYear.end))).all();
  for (const c of corrections) {
    const entry = db.select().from(financeEntries).where(eq(financeEntries.id, c.entryId)).get()!;
    const designation = entry.fiscalYearId ? (db.select({ d: financeFiscalYears.designation }).from(financeFiscalYears).where(eq(financeFiscalYears.id, entry.fiscalYearId)).get()?.d ?? '') : '';
    // Der Betrag der umgebuchten Zeile (264).
    const lineCents = db.select({ cents: financeAllocationLines.amountCents }).from(financeAllocationLines).where(eq(financeAllocationLines.id, c.lineId)).get()?.cents ?? null;
    out.correction.push(row('correction', c.id, entry, lineCents, { section153: c.section153, entryYear: designation }, dayOf(c.approvedAt!)));
  }

  // Spät Festgeschriebenes: bar nach mehr als `lateFinalizeCashDays` Tagen, unbar nach Ablauf des Folgemonats. Mit dem
  // Betrag der Buchung wie im Journal (Designer Runde 5, 264), gerechnet wie bei den Stornos.
  const moneyOf = (entryId: string) => money.filter((m) => m.entryId === entryId).reduce((s, m) => s + m.amountCents, 0);
  for (const e of entries) {
    if (!e.finalizedAt) continue;
    const finalizedOn = dayOf(e.finalizedAt);
    if (onCash(e.id)) {
      const limit = Number(valueAt(db, 'lateFinalizeCashDays', e.entryDate) ?? valueAt(db, 'lateFinalizeCashDays', '9999-12-31') ?? 1);
      if (daysBetween(e.entryDate, finalizedOn) > limit) out.lateFinalized.push(row('lateFinalized', e.id, e, moneyOf(e.id), { finalizedOn, cash: true, days: daysBetween(e.entryDate, finalizedOn) }));
    } else if (finalizedOn > endOfFollowingMonth(e.entryDate)) out.lateFinalized.push(row('lateFinalized', e.id, e, moneyOf(e.id), { finalizedOn, cash: false, days: daysBetween(e.entryDate, finalizedOn) }));
  }

  // Kassenfehlbeträge.
  const counts = db.select().from(financeCashCounts).where(and(gte(financeCashCounts.countedOn, year.startsOn), lte(financeCashCounts.countedOn, year.endsOn), lt(financeCashCounts.differenceCents, 0))).orderBy(asc(financeCashCounts.countedOn)).all();
  for (const c of counts) out.cashShortfall.push(row('cashShortfall', c.id, null, c.differenceCents, { documentNumber: c.documentNumber }, c.countedOn));

  // Negative Kassenzeiträume: ab dem Tag nach dem Wiederauftauchen erneut gesucht, bis Jahresende.
  for (const account of db.select().from(financeAccounts).where(eq(financeAccounts.kind, 'cash')).all()) {
    const days = [...new Set(db.select({ d: financeEntries.entryDate }).from(financeMoneyLines).innerJoin(financeEntries, eq(financeEntries.id, financeMoneyLines.entryId)).where(and(eq(financeMoneyLines.accountId, account.id), eq(financeEntries.status, 'final'))).all().map((r) => r.d))].sort();
    let from = year.startsOn;
    for (;;) {
      const negative = firstNegativeCashDay(db, account, from, []);
      if (!negative || negative.date > year.endsOn) break;
      const balanceOn = (day: string) => accountBalancesAt(db, day).find((b) => b.accountId === account.id)?.balanceCents ?? 0;
      const recovered = days.find((d) => d > negative.date && balanceOn(d) >= 0) ?? null;
      out.cashNegative.push(row('cashNegative', `${account.id}:${negative.date}`, null, negative.balanceCents, { accountName: account.name, from: negative.date, until: recovered }, negative.date));
      if (!recovered) break;
      from = dayAfter(recovered);
    }
  }

  // Partnerzahlungen mit Begründung oder nachträglicher Freigabe.
  const payments = db.select().from(financePartnerPayments).where(and(isNotNull(financePartnerPayments.approvedAt), gte(financePartnerPayments.approvedAt, inYear.start), lt(financePartnerPayments.approvedAt, inYear.end))).all();
  for (const p of payments) {
    const reasons = [p.retroactive && 'retroactive', p.basisOverrideReason && 'basisOverride', p.noticeReason && 'notice', p.overdueReason && 'overdue', p.purposeNegativeReason && 'purposeNegative'].filter((r): r is string => Boolean(r));
    if (reasons.length) out.partnerPaymentReason.push(row('partnerPaymentReason', p.id, null, null, { paymentNumber: p.number ?? '', reasons: reasons.join(',') }, dayOf(p.approvedAt!)));
  }
  // Mehrfach verwendete Nachweise (Rechenschaft B1 Task 8): dieselbe Rechnung wie die Belegprüfung, je Gruppe eine Zeile.
  for (const group of reusedEvidenceInternal(db, { from: year.startsOn, to: year.endsOn }, timeZone)) {
    const first = group.uses.find((u) => u.date >= year.startsOn && u.date <= year.endsOn) ?? group.uses[0]!;
    const documentId = group.uses.find((u) => u.documentId)?.documentId;
    out.evidenceReused.push({ ...row('evidenceReused', group.key, null, null, { number: first.documentNumber ?? '', uses: group.uses.map((u) => u.refNumber ?? '').filter(Boolean).join(', ') }, first.date), ...(documentId ? { documentId } : {}) });
  }

  // Wiederöffnungen.
  for (const ev of db.select().from(financePeriodEvents).where(and(eq(financePeriodEvents.fiscalYearId, year.id), eq(financePeriodEvents.kind, 'reopened'))).orderBy(asc(financePeriodEvents.at)).all()) {
    out.reopened.push(row('reopened', ev.id, null, null, { byUserId: ev.byUserId }, dayOf(ev.at)));
  }

  // Änderungen der Nutzer-Kontakt-Verknüpfung im Jahr, selbst gesetzte gekennzeichnet.
  for (const link of userLinkChangesInternal(db, { from: year.startsOn, to: year.endsOn })) {
    out.userLink.push(row('userLink', link.id, null, null, { userId: link.userId, linkedAt: link.linkedAt, unlinkedAt: link.unlinkedAt, selfLinked: link.selfLinked }, dayOf(link.unlinkedAt && link.unlinkedAt >= link.linkedAt && dayOf(link.linkedAt) < year.startsOn ? link.unlinkedAt : link.linkedAt)));
  }

  // Über MCP Festgeschriebenes.
  for (const e of entries) if (e.finalizedChannel === 'mcp') out.finalizedByAgent.push(row('finalizedByAgent', e.id, e, null, { finalizedByUserId: e.finalizedByUserId }));

  // Rechenschaft C: Korrekturen an Vorjahren, die nach der MV in dieses Jahr übernommen wurden (eine Gruppe statt eines neunten Abschnitts, Claude).
  for (const c of carriedIntoYearInternal(db, year.id)) out.priorYearCarryOver.push(row('priorYearCarryOver', c.entryId, null, null, { number: c.entryNumber, year: c.fiscalYearDesignation, change: c.change }, year.startsOn));

  return ANOMALY_KINDS.flatMap((kind) => out[kind]);
}
