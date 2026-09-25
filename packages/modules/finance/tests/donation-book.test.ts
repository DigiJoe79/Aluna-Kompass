import { schema, unwrap, writeSettingInternal } from '@kompass/core';
import { ctxWith, systemContext } from '@kompass/core/testing';
import { createContact } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { getDonationBook, getDonationReconciliation } from '../src/donations/book';
import { issueConfirmation, voidConfirmation } from '../src/donations/confirmations';
import { bookEntry } from '../src/ledger/finalize';
import { createPurpose } from '../src/ledger/purposes';
import { reverseEntry } from '../src/ledger/reverse';
import { donationFixture, type DonationFixture } from './donation-fixture';

const setSetting = (f: DonationFixture, key: string, value: unknown) =>
  f.deps.db.transaction((tx) => writeSettingInternal(tx, f.deps, systemContext(), key, value, 'test.donationBook'));

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
      toCorrect: { count: 0, cents: 0, href: '/finance/donations?tab=toCorrect' },
      simplifiedReceiptLimitCents: 30000,
    });
    expect(rec.reasons.reduce((s, r) => s + r.cents, 0) - rec.toCorrect.cents).toBe(rec.differenceCents);
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
    expect(rec).toMatchObject({ donationsCents: 2000, confirmedCents: 8000, differenceCents: -6000, reasons: [], toCorrect: { count: 2, cents: 6000 } });
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
