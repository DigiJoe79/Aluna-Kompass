import { schema, unwrap, writeSettingInternal } from '@kompass/core';
import { ctxWith, systemContext } from '@kompass/core/testing';
import { createContact } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { getDonationBook, getDonationReconciliation } from '../src/donations/book';
import { issueConfirmation, voidConfirmation } from '../src/donations/confirmations';
import { bookEntry } from '../src/ledger/finalize';
import { createPurpose } from '../src/ledger/purposes';
import { reverseEntry } from '../src/ledger/reverse';
import { donationFixture, EXEMPTION, type DonationFixture } from './donation-fixture';
import { saveNotice, supersedeNotice } from '../src/donations/notices';
import { toCorrectConfirmationsOfYearInternal } from '../src/donations/to-correct';

const setSetting = (f: DonationFixture, key: string, value: unknown) =>
  f.deps.db.transaction((tx) => writeSettingInternal(tx, f.deps, systemContext(), key, value));

const person = async (f: DonationFixture, firstName: string, lastName: string, address = true) =>
  unwrap(await createContact(f.deps, f.manage, { kind: 'person', firstName, lastName, ...(address ? { street: 'Probeweg 3', postalCode: '11111', city: 'Probestadt' } : {}) }));

describe('getDonationBook', () => {
  it('lists the four kinds of the year with contact or anonymous, returns as negative rows, and sums per kind', async () => {
    const f = await donationFixture({ machine: true });
    await f.donate({ date: '2025-12-30', cents: 1000 }); // Vorjahr — nicht im Buch 2026.
    const money = await f.donate({ date: '2026-01-15', cents: 5000 });
    const purpose = unwrap(await createPurpose(f.deps, f.ctx, { name: 'Futterhilfe' }));
    const bound = unwrap(
      await bookEntry(f.deps, f.ctx, {
        entryDate: '2026-01-20', text: 'Zweckspende',
        moneyLines: [{ accountId: f.bank.id, amountCents: 1500 }],
        allocationLines: [{ categoryId: f.categoryByKey('donations').id, amountCents: 1500, contactId: f.erika.id, purposeId: purpose.id }],
      }),
    );
    const fee = await f.donate({ date: '2026-02-01', cents: 3600, categoryKey: 'membership-fees' });
    const waiver = await f.waive({ date: '2026-02-10', cents: 4200 });
    const inKind = await f.giveInKind({ date: '2026-02-20', cents: 25000 });
    const anonymous = await f.donate({ date: '2026-02-25', cents: 2000, contactId: null });
    const reversed = await f.donate({ date: '2026-03-01', cents: 700 });
    unwrap(await reverseEntry(f.deps, f.ctx, { id: reversed.entry.id }));
    const confirmation = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [money.line.id, fee.line.id], kind: 'collective' }));
    // Prüfstein 6: Rücklastschrift einer Spende, die schon in einer Sammelbestätigung steht.
    const returned = await f.giveBack(money.line.id, 5000, '2026-03-10');

    const book = unwrap(await getDonationBook(f.deps, f.ctx, { year: 2026 }));
    expect(book.membershipFeesCertifiable).toBe(true);
    expect(book.total).toBe(7);
    expect(book.rows.map((r) => [r.lineId, r.kind, r.amountCents, r.contactId, r.contactName, r.purposeName, r.confirmation])).toEqual([
      [money.line.id, 'donation', 5000, f.erika.id, 'Erika Beispiel', null, { id: confirmation.id, number: confirmation.documentNumber, kind: 'collective' }],
      [bound.allocationLines[0]!.id, 'donation', 1500, f.erika.id, 'Erika Beispiel', 'Futterhilfe', null],
      [fee.line.id, 'membershipFee', 3600, f.erika.id, 'Erika Beispiel', null, { id: confirmation.id, number: confirmation.documentNumber, kind: 'collective' }],
      [waiver.line.id, 'expenseWaiver', 4200, f.erika.id, 'Erika Beispiel', null, null],
      [inKind.line.id, 'inKindDonation', 25000, f.erika.id, 'Erika Beispiel', null, null],
      [anonymous.line.id, 'donation', 2000, null, null, null, null],
      [returned.line.id, 'donation', -5000, f.erika.id, 'Erika Beispiel', null, null],
    ]);
    expect(book.rows[0]).toMatchObject({ entryId: money.entry.id, entryNumber: money.entry.number, entryDate: '2026-01-15' });
    expect(book.sums).toEqual({ donation: 5000 + 1500 + 2000 - 5000, membershipFee: 3600, inKindDonation: 25000, expenseWaiver: 4200, total: 3500 + 3600 + 25000 + 4200 });

    // Blättern: die Summen gelten dem ganzen Jahr, nicht der Seite.
    const page = unwrap(await getDonationBook(f.deps, f.ctx, { year: 2026, limit: 2, offset: 5 }));
    expect(page.rows.map((r) => r.lineId)).toEqual([anonymous.line.id, returned.line.id]);
    expect(page).toMatchObject({ total: 7, sums: book.sums });
    expect(unwrap(await getDonationBook(f.deps, f.ctx, { year: 2025 })).rows).toHaveLength(1);
  });

  it('hides membership fees while they are not certifiable', async () => {
    const f = await donationFixture();
    await f.donate({ date: '2026-01-15', cents: 5000 });
    await f.donate({ date: '2026-02-01', cents: 3600, categoryKey: 'membership-fees' });
    setSetting(f, 'finance.membershipFeesCertifiable', false);

    const book = unwrap(await getDonationBook(f.deps, f.ctx, { year: 2026 }));
    expect(book.membershipFeesCertifiable).toBe(false);
    expect(book.rows.map((r) => r.kind)).toEqual(['donation']);
    expect(book.sums).toEqual({ donation: 5000, membershipFee: 0, inKindDonation: 0, expenseWaiver: 0, total: 5000 });
  });

  it('filters anonymous lines before paging: total counts only them, the sums stay for the whole year', async () => {
    const f = await donationFixture();
    await f.donate({ date: '2026-01-15', cents: 5000 });
    await f.donate({ date: '2026-02-01', cents: 2000, contactId: null });
    await f.donate({ date: '2026-02-02', cents: 3000, contactId: null });

    const book = unwrap(await getDonationBook(f.deps, f.ctx, { year: 2026, contact: 'anonymous', limit: 1 }));
    expect(book.total).toBe(2);
    expect(book.rows).toHaveLength(1);
    expect(book.rows.every((r) => r.contactId === null)).toBe(true);
    expect(book.sums.total).toBe(10000);
    const second = unwrap(await getDonationBook(f.deps, f.ctx, { year: 2026, contact: 'anonymous', limit: 1, offset: 1 }));
    expect(second.rows.map((r) => r.amountCents)).not.toEqual(book.rows.map((r) => r.amountCents));
    expect(await getDonationBook(f.deps, f.ctx, { year: 2026, contact: 'someone' })).toMatchObject({ ok: false, error: { type: 'validation' } });
  });

  it('needs finance.read, validates the year and writes nothing to the audit log', async () => {
    const f = await donationFixture();
    const before = f.deps.db.select().from(schema.auditLog).all().length;
    expect(await getDonationBook(f.deps, ctxWith([], 'NOBODY'), { year: 2026 })).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'finance.read' } });
    expect(await getDonationBook(f.deps, f.ctx, { year: 'x' })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(await getDonationBook(f.deps, f.ctx, { year: 2026, limit: 1000 })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect((await getDonationBook(f.deps, ctxWith(['finance.read'], 'READER'), { year: 2026 })).ok).toBe(true);
    expect(f.deps.db.select().from(schema.auditLog).all()).toHaveLength(before);
  });
});

describe('getDonationReconciliation', () => {
  it('reconciles donations against valid confirmations and splits the difference by reason with a link each', async () => {
    const f = await donationFixture({ machine: true });
    setSetting(f, 'finance.batchMinimumCents', 1000);
    const money = await f.donate({ date: '2026-01-15', cents: 5000 });
    const fee = await f.donate({ date: '2026-02-01', cents: 3600, categoryKey: 'membership-fees' });
    unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [money.line.id, fee.line.id], kind: 'collective' }));
    await f.waive({ date: '2026-02-10', cents: 4200 });
    const undescribed = await f.giveInKind({ date: '2026-02-20', cents: 9000 });
    f.attachVoucher(undescribed.entry.id);
    await f.donate({ date: '2026-02-25', cents: 2000, contactId: null });
    const small = await person(f, 'Klara', 'Klein');
    await f.donate({ date: '2026-02-26', cents: 500, contactId: small.id });
    const noAddress = await person(f, 'Otto', 'Ohneort', false);
    await f.donate({ date: '2026-02-27', cents: 3000, contactId: noAddress.id });
    const max = await person(f, 'Max', 'Probe');
    await f.donate({ date: '2026-02-28', cents: 2500, contactId: max.id });
    // Eine zurückgenommene Bestätigung ist keine gültige — ihre Zuwendung zählt als offen.
    const tom = await person(f, 'Tom', 'Taler');
    const tomLine = await f.donate({ date: '2026-03-02', cents: 1200, contactId: tom.id });
    const voided = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [tomLine.line.id] }));
    unwrap(await voidConfirmation(f.deps, f.ctx, { id: voided.id, note: 'Falscher Betrag', alreadySent: false }));

    const rec = unwrap(await getDonationReconciliation(f.deps, f.ctx, { year: 2026 }));
    expect(rec).toEqual({
      year: 2026,
      donationsCents: 31000,
      confirmedCents: 8600,
      differenceCents: 22400,
      reasons: [
        { key: 'belowMinimum', count: 1, cents: 500, href: '/finance/donations?tab=uncertified' },
        { key: 'addressMissing', count: 1, cents: 3000, href: '/finance/donations/run?year=2026' },
        { key: 'inKindUndescribed', count: 1, cents: 9000, href: '/finance/donations?tab=uncertified' },
        { key: 'expenseWaiverUnconfirmed', count: 1, cents: 4200, href: '/finance/donations?tab=uncertified' },
        { key: 'anonymous', count: 1, cents: 2000, href: '/finance/donations/book?year=2026&contact=anonymous' },
        { key: 'other', count: 2, cents: 3700, href: '/finance/donations/run?year=2026' },
      ],
      toCorrect: { count: 0, cents: 0, withoutAmountCount: 0, href: '/finance/donations?tab=toCorrect' },
      simplifiedReceiptLimitCents: 30000,
    });
    expect(rec.reasons.reduce((s, r) => s + r.cents, 0)).toBe(rec.differenceCents);
  });

  it('names a return across the year end as its own item, not as „other“ (Designer Runde 6, 264; Runde 8, 272)', async () => {
    const f = await donationFixture({ machine: true });
    const last = await f.donate({ date: '2025-12-20', cents: 6000 });
    await f.giveBack(last.line.id, 6000, '2026-01-10');
    const rec = unwrap(await getDonationReconciliation(f.deps, f.ctx, { year: 2026 }));
    expect(rec.reasons).toEqual([{ key: 'returnOtherYear', count: 1, cents: -6000, href: '/finance/donations/book?year=2026' }]);
  });

  it('explains the difference with its rows alone when a confirmed gift is returned in a later year (Designer Runde 8, 272)', async () => {
    const f = await donationFixture({ machine: true, years: ['2026', '2027'] });
    const full = await f.donate({ date: '2026-01-15', cents: 6000 });
    unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [full.line.id] }));
    await f.donate({ date: '2026-02-25', cents: 17000, contactId: null });
    f.deps.clock.set('2027-01-20T09:00:00.000Z');
    await f.giveBack(full.line.id, 6000, '2027-01-10');
    const rec = unwrap(await getDonationReconciliation(f.deps, f.ctx, { year: 2026 }));
    expect(rec).toMatchObject({ differenceCents: 17000, reasons: [{ key: 'anonymous', count: 1, cents: 17000 }], toCorrect: { count: 1, cents: 6000 } });
    expect(rec.reasons.reduce((s, r) => s + r.cents, 0)).toBe(rec.differenceCents);
  });

  // N18 (Nachttest 0.4.0, Joe 2026-10-27): Spendenbuch und Schritt 7 zählen „zu korrigieren“ aus derselben Quelle; der
  // Betrag bleibt der betragswirksame, die übrigen nennt der Satz als „davon ohne Auswirkung auf den Betrag“.
  it('counts every confirmation to correct like step 7, the amount only from returns', async () => {
    const f = await donationFixture({ machine: true });
    const returnedGift = await f.donate({ date: '2026-01-15', cents: 5000 });
    unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [returnedGift.line.id] }));
    const max = await person(f, 'Max', 'Probe');
    const kept = await f.donate({ date: '2026-02-01', cents: 3000, contactId: max.id });
    unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [kept.line.id] }));
    await f.giveBack(returnedGift.line.id, 2000, '2026-03-10');
    // Der Bescheid wird ersetzt: Beide Bestätigungen sind zu korrigieren, nur die mit Rückgabe ändert den Betrag.
    unwrap(await saveNotice(f.deps, f.ctx, { ...EXEMPTION, noticeDate: '2026-03-20', assessmentPeriod: '2024' }));
    unwrap(await supersedeNotice(f.deps, f.ctx, { id: f.notice!.id, supersededOn: '2026-03-20' }));

    const rec = unwrap(await getDonationReconciliation(f.deps, f.ctx, { year: 2026 }));
    expect(rec.toCorrect).toEqual({ count: 2, cents: 2000, withoutAmountCount: 1, href: '/finance/donations?tab=toCorrect' });
    expect(rec.toCorrect.count).toBe(toCorrectConfirmationsOfYearInternal(f.deps.db, f.years['2026']!.id).length);
    expect(rec.reasons.reduce((s, r) => s + r.cents, 0)).toBe(rec.differenceCents);
  });

  it('shows confirmations above donations as toCorrect', async () => {
    const f = await donationFixture({ machine: true });
    // Prüfstein 6: Rücklastschrift einer ganz bestätigten Spende, dazu eine Teilrückzahlung.
    const full = await f.donate({ date: '2026-01-15', cents: 5000 });
    unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [full.line.id] }));
    await f.giveBack(full.line.id, 5000, '2026-03-10');
    const max = await person(f, 'Max', 'Probe');
    const part = await f.donate({ date: '2026-02-01', cents: 3000, contactId: max.id });
    unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [part.line.id] }));
    await f.giveBack(part.line.id, 1000, '2026-03-11');

    const rec = unwrap(await getDonationReconciliation(f.deps, f.ctx, { year: 2026 }));
    // Die Rückgaben liegen im selben Jahr: Die Bestätigungen über sie hinaus erklären die Differenz als eigene Zeile.
    expect(rec).toMatchObject({ donationsCents: 2000, confirmedCents: 8000, differenceCents: -6000, reasons: [{ key: 'confirmedAboveReturns', count: 2, cents: -6000, href: '/finance/donations?tab=toCorrect' }], toCorrect: { count: 2, cents: 6000 } });
    const book = unwrap(await getDonationBook(f.deps, f.ctx, { year: 2026 }));
    expect(book.rows.filter((r) => r.amountCents < 0).map((r) => r.amountCents)).toEqual([-5000, -1000]);
  });

  it('needs finance.read and validates the year', async () => {
    const f = await donationFixture();
    expect(await getDonationReconciliation(f.deps, ctxWith([], 'NOBODY'), { year: 2026 })).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'finance.read' } });
    expect(await getDonationReconciliation(f.deps, f.ctx, {})).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(unwrap(await getDonationReconciliation(f.deps, ctxWith(['finance.read'], 'READER'), { year: 2026 }))).toMatchObject({ donationsCents: 0, confirmedCents: 0, differenceCents: 0, reasons: [] });
  });
});
