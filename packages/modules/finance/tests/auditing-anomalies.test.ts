import { newId, unwrap } from '@kompass/core';
import { contactRoles, contactUserLinks } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { anomalyRowsInternal } from '../src/auditing/anomalies';
import { getAuditSection } from '../src/auditing/sections';
import { requestAllocationCorrection } from '../src/ledger/corrections';
import { reverseEntry } from '../src/ledger/reverse';
import { financeAllocationLines, financeCashCounts, financeEntries, financeEntryDocuments, financeFiscalYears, financeMoneyLines, financePartnerEvidence, financePartnerPayments, financePartnerProfiles, financePeriodEvents } from '../src/schema';
import { eq } from 'drizzle-orm';
import { auditFixture } from './auditing-fixture';

type F = Awaited<ReturnType<typeof auditFixture>>['f'];

/** Eine festgeschriebene Buchung direkt eingefügt — für Fälle, die die Dienste (zu Recht) nicht zulassen. */
function insertFinal(f: F, o: { yearId: string; date: string; accountId: string; cents: number; categoryId: string; contactId?: string; finalizedAt?: string; channel?: string; number: string }): string {
  const id = newId();
  f.deps.db.insert(financeEntries).values({ id, entryDate: o.date, text: 'Eingefügt', status: 'draft', fiscalYearId: o.yearId, createdByUserId: f.userId, createdChannel: 'ui', createdAt: `${o.date}T10:00:00.000Z`, updatedAt: `${o.date}T10:00:00.000Z` }).run();
  f.deps.db.insert(financeMoneyLines).values({ id: newId(), entryId: id, position: 0, accountId: o.accountId, amountCents: o.cents }).run();
  f.deps.db.insert(financeAllocationLines).values({ id: newId(), entryId: id, position: 0, categoryId: o.categoryId, amountCents: o.cents, ...(o.contactId ? { contactId: o.contactId } : {}) }).run();
  f.deps.db.update(financeEntries).set({ number: o.number, status: 'final', finalizedAt: o.finalizedAt ?? `${o.date}T12:00:00.000Z`, finalizedByUserId: f.userId, finalizedChannel: o.channel ?? 'ui' }).where(eq(financeEntries.id, id)).run();
  return id;
}

describe('Auffälligkeiten (Finanz-Spec § 9.4)', () => {
  it('finds each kind with the values of its source, grouped by kind', async () => {
    const a = await auditFixture({ close: false });
    const { f, y2025 } = a;
    const year = f.deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, y2025)).get()!;
    const board = await a.person('Vorstand');
    f.deps.db.insert(contactRoles).values({ id: newId(), contactId: board.id, role: 'board-member', since: '2024-01-01', until: null, note: null }).run();

    const related = insertFinal(f, { yearId: y2025, date: '2025-02-01', accountId: f.bank.id, cents: -3000, categoryId: f.programCosts.id, contactId: board.id, number: '2025-9001' });
    const payoutCashIn = insertFinal(f, { yearId: y2025, date: '2025-02-02', accountId: f.cash.id, cents: 200000, categoryId: f.donations.id, number: '2025-9002' });
    const payout = insertFinal(f, { yearId: y2025, date: '2025-02-03', accountId: f.cash.id, cents: -2500, categoryId: f.programCosts.id, number: '2025-9003', finalizedAt: '2025-02-10T12:00:00.000Z' });
    const round = insertFinal(f, { yearId: y2025, date: '2025-03-01', accountId: f.bank.id, cents: -60000, categoryId: f.programCosts.id, number: '2025-9004', finalizedAt: '2025-06-01T12:00:00.000Z', channel: 'mcp' });
    // Negative Kasse vom 05.04. bis zur Einzahlung am 08.04.; danach noch einmal ab 01.05.
    insertFinal(f, { yearId: y2025, date: '2025-04-05', accountId: f.cash.id, cents: -300000, categoryId: f.programCosts.id, number: '2025-9005' });
    insertFinal(f, { yearId: y2025, date: '2025-04-08', accountId: f.cash.id, cents: 200000, categoryId: f.donations.id, number: '2025-9006' });
    insertFinal(f, { yearId: y2025, date: '2025-05-01', accountId: f.cash.id, cents: -200000, categoryId: f.programCosts.id, number: '2025-9007' });
    insertFinal(f, { yearId: y2025, date: '2025-05-03', accountId: f.cash.id, cents: 500000, categoryId: f.donations.id, number: '2025-9008' });
    const reversed = insertFinal(f, { yearId: y2025, date: '2025-06-01', accountId: f.bank.id, cents: 700, categoryId: f.donations.id, contactId: f.wrongDonor.id, number: '2025-9009' });
    unwrap(await reverseEntry(f.deps, f.ctx, { id: reversed }));
    const corrected = insertFinal(f, { yearId: y2025, date: '2025-06-02', accountId: f.bank.id, cents: 900, categoryId: f.donations.id, contactId: f.wrongDonor.id, number: '2025-9010' });
    const line = f.deps.db.select().from(financeAllocationLines).where(eq(financeAllocationLines.entryId, corrected)).get()!;
    f.deps.clock.set('2025-07-01T09:00:00.000Z');
    unwrap(await requestAllocationCorrection(f.deps, f.ctx, { lineId: line.id, changes: { contactId: f.rightDonor.id }, note: 'Falsch zugeordnet' }));
    f.deps.db.insert(financeCashCounts).values({ id: newId(), accountId: f.cash.id, countedOn: '2025-08-01', countedCents: 100, bookCents: 600, differenceCents: -500, counterOneContactId: board.id, counterTwoContactId: f.donor.id, counterOneName: 'A', counterTwoName: 'B', note: 'fehlt', documentNumber: 'KZP-2025-0001', createdByUserId: f.userId, createdAt: '2025-08-01T10:00:00.000Z' }).run();
    const partnerId = newId();
    f.deps.db.insert(financePartnerProfiles).values({ id: partnerId, contactId: f.rightDonor.id, status: 'taxExemptBody', createdAt: 'x', createdByUserId: f.userId, updatedAt: 'x' }).run();
    const paymentId = newId();
    const otherPayment = newId();
    for (const [id, number, retroactive] of [[paymentId, 'PZ-2025-0001', true], [otherPayment, 'PZ-2025-0002', false]] as const) {
      f.deps.db.insert(financePartnerPayments).values({ id, number, partnerId, basis: 'transfer58', state: 'approved', retroactive, approvedAt: '2025-09-01T10:00:00.000Z', approvedByUserId: f.userId, createdByUserId: f.userId, createdAt: 'x', updatedAt: 'x' } as never).run();
      f.deps.db.insert(financePartnerEvidence).values({ id: newId(), paymentId: id, kind: 'invoice', documentId: 'DOC-SHARED', addedByUserId: f.userId, addedAt: '2025-09-02T10:00:00.000Z' }).run();
    }
    // Ein Beleg an zwei Buchungen zählt seit B1 ebenso (dieselbe Rechnung wie die Belegprüfung).
    for (const entryId of [related, round]) f.deps.db.insert(financeEntryDocuments).values({ id: newId(), entryId, documentId: 'DOC-TWICE', documentNumber: 'BEL-2025-0001', documentChecksum: 'twice', addedAt: '2025-03-02T10:00:00.000Z', addedByUserId: f.userId }).run();
    f.deps.db.insert(financePeriodEvents).values({ id: newId(), fiscalYearId: y2025, kind: 'reopened', at: '2025-10-01T00:00:00.000Z', byUserId: f.userId, reason: 'x' }).run();
    f.deps.db.insert(contactUserLinks).values({ id: newId(), userId: f.userId, contactId: f.donor.id, linkedAt: '2025-11-01T00:00:00.000Z', linkedByUserId: f.userId, unlinkedAt: null, unlinkedByUserId: null }).run();
    f.deps.clock.set('2026-09-05T08:00:00.000Z');

    const rows = anomalyRowsInternal(f.deps, year);
    const of = (kind: string) => rows.filter((r) => r.kind === kind);
    expect(of('relatedParty').map((r) => r.entryId)).toEqual([related]);
    expect(of('relatedParty')[0]!.labelParams).toMatchObject({ role: 'board-member', contactName: 'Testa Vorstand', originKind: 'other' });
    expect(of('cashPayout').map((r) => r.entryId)).toEqual(expect.arrayContaining([payout]));
    expect(of('roundAmount').map((r) => r.entryId)).toContain(round);
    expect(of('cashDonation').map((r) => r.entryId)).toContain(payoutCashIn);
    expect(of('reversal')).toEqual([expect.objectContaining({ amountCents: -700, labelParams: expect.objectContaining({ reversedNumber: '2025-9009' }) })]);
    expect(of('correction')).toEqual([expect.objectContaining({ entryId: corrected, amountCents: 900, labelParams: expect.objectContaining({ section153: false, entryYear: '2025' }) })]);
    expect(of('lateFinalized').map((r) => [r.entryId, r.labelParams.cash])).toEqual(expect.arrayContaining([[payout, true], [round, false]]));
    // Der Betrag der Buchung wie im Journal, nicht „—“ (264).
    expect(of('lateFinalized').find((r) => r.entryId === round)!.amountCents).toBe(-60000);
    expect(of('cashShortfall')).toEqual([expect.objectContaining({ amountCents: -500, date: '2025-08-01' })]);
    expect(of('cashNegative').map((r) => [r.labelParams.from, r.labelParams.until])).toEqual([['2025-04-05', '2025-04-08'], ['2025-05-01', '2025-05-03']]);
    expect(of('partnerPaymentReason').map((r) => r.labelParams)).toEqual([{ paymentNumber: 'PZ-2025-0001', reasons: 'retroactive' }]);
    // Je Gruppe eine Zeile: die Nachweise an den zwei Zahlungen und der Beleg an den zwei Buchungen.
    expect(of('evidenceReused').map((r) => r.labelParams.uses)).toEqual(expect.arrayContaining(['2025-9001, 2025-9004', 'PZ-2025-0001, PZ-2025-0002']));
    expect(of('evidenceReused')).toHaveLength(2);
    expect(of('reopened')).toHaveLength(1);
    expect(of('userLink')).toEqual([expect.objectContaining({ labelParams: expect.objectContaining({ selfLinked: true }) })]);
    expect(of('finalizedByAgent').map((r) => r.entryId)).toEqual([round]);
    // Gruppiert: jede Art steht zusammen.
    const order = rows.map((r) => r.kind);
    expect(order).toEqual([...order].sort((x, y) => order.indexOf(x) - order.indexOf(y)));

    f.closeYear(y2025);
    const section = unwrap(await getAuditSection(f.deps, a.mira.ctx, { fiscalYearId: y2025, section: 'anomalies', limit: 200 }));
    expect(section.total).toBe(rows.length);
  });
});
