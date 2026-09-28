import { schema, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { checkConfirmable, type ConfirmationCheck, type ConfirmationCheckKey } from '../src/donations/check';
import { issueConfirmation, listUncertifiedDonations } from '../src/donations/confirmations';
import { markNotReturn } from '../src/ledger/not-return';
import { getEntry, saveDraft } from '../src/ledger/entries';
import { bookEntry } from '../src/ledger/finalize';
import { donationFixture, err, type DonationFixture } from './donation-fixture';

const check = (r: { checks: ConfirmationCheck[] }, key: ConfirmationCheckKey): ConfirmationCheck => r.checks.find((c) => c.key === key)!;

/** Eine festgeschriebene Auszahlung an Erika ohne `originLineId` — so, wie eine PayPal-Rückzahlung ohne Verknüpfung gebucht wird. */
async function payOut(f: DonationFixture, o: { cents: number; date?: string; categoryKey?: string }) {
  return unwrap(
    await bookEntry(f.deps, f.ctx, {
      entryDate: o.date ?? '2026-03-12', text: 'Auszahlung an Erika',
      moneyLines: [{ accountId: f.bank.id, amountCents: -o.cents }],
      allocationLines: [{ categoryId: f.categoryByKey(o.categoryKey ?? 'donations').id, amountCents: -o.cents, contactId: f.erika.id }],
    }),
  );
}

describe('possibleReturnWithoutOrigin — also partial amounts (AC)', () => {
  it('blocks a 200 € donation while a 50 € payment to the donor after it is booked without originLineId', async () => {
    const f = await donationFixture();
    const gift = await f.donate({ cents: 20000 });
    const refund = await payOut(f, { cents: 5000 });
    const res = unwrap(await checkConfirmable(f.deps, f.ctx, { lineIds: [gift.line.id] }));
    expect(check(res, 'possibleReturnWithoutOrigin')).toMatchObject({ done: false, blocked: true, detail: { entryNumber: refund.number }, remedy: { href: `/finance/entries/${refund.id}`, labelKey: 'openEntry' } });
    expect(err(await issueConfirmation(f.deps, f.ctx, { lineIds: [gift.line.id] }))).toMatchObject({ type: 'conflict', code: 'confirmationPossibleReturnWithoutOrigin' });
    const uncertified = unwrap(await listUncertifiedDonations(f.deps, f.ctx, {}));
    expect(uncertified.groups.flatMap((g) => g.lines).find((l) => l.lineId === gift.line.id)!.warnings).toContain('possibleReturnWithoutOrigin');
  });

  it('confirms 150 € once the 50 € refund points to the donation', async () => {
    const f = await donationFixture();
    const gift = await f.donate({ cents: 20000 });
    await f.giveBack(gift.line.id, 5000, '2026-03-12');
    const res = unwrap(await checkConfirmable(f.deps, f.ctx, { lineIds: [gift.line.id] }));
    expect(check(res, 'possibleReturnWithoutOrigin')).toMatchObject({ done: true, blocked: false });
    expect(res.lines[0]!.netCents).toBe(15000);
    expect(unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [gift.line.id] })).totalCents).toBe(15000);
  });

  it('ignores payments before the donation, above its amount and drafts', async () => {
    const f = await donationFixture();
    const gift = await f.donate({ cents: 20000 });
    await payOut(f, { cents: 5000, date: '2026-03-01' });
    await payOut(f, { cents: 30000 });
    unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-12', text: 'Entwurf', moneyLines: [{ accountId: f.bank.id, amountCents: -5000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: -5000, contactId: f.erika.id }] }));
    const res = unwrap(await checkConfirmable(f.deps, f.ctx, { lineIds: [gift.line.id] }));
    expect(check(res, 'possibleReturnWithoutOrigin')).toMatchObject({ done: true, blocked: false });
  });

  it('a payment marked „is not a return“ no longer blocks; lifting the mark blocks again', async () => {
    const f = await donationFixture();
    const gift = await f.donate({ cents: 20000 });
    const payment = await payOut(f, { cents: 4000, categoryKey: 'program-costs' });
    expect(check(unwrap(await checkConfirmable(f.deps, f.ctx, { lineIds: [gift.line.id] })), 'possibleReturnWithoutOrigin').blocked).toBe(true);

    expect(unwrap(await markNotReturn(f.deps, f.ctx, { entryId: payment.id, notReturn: true, note: 'Erstattung einer Auslage' }))).toEqual({ entryId: payment.id, notReturn: true });
    expect(check(unwrap(await checkConfirmable(f.deps, f.ctx, { lineIds: [gift.line.id] })), 'possibleReturnWithoutOrigin').blocked).toBe(false);
    expect(unwrap(await getEntry(f.deps, f.ctx, { id: payment.id })).notReturn).toMatchObject({ note: 'Erstattung einer Auslage' });

    unwrap(await markNotReturn(f.deps, f.ctx, { entryId: payment.id, notReturn: false }));
    expect(check(unwrap(await checkConfirmable(f.deps, f.ctx, { lineIds: [gift.line.id] })), 'possibleReturnWithoutOrigin').blocked).toBe(true);
    expect(unwrap(await getEntry(f.deps, f.ctx, { id: payment.id })).notReturn).toBeNull();
  });
});

describe('markNotReturn', () => {
  it('needs finance.entriesFinalize, a note, a finalized entry — and logs without the note', async () => {
    const f = await donationFixture();
    const payment = await payOut(f, { cents: 4000, categoryKey: 'program-costs' });
    expect(err(await markNotReturn(f.deps, ctxWith(['finance.read', 'finance.entriesWrite']), { entryId: payment.id, notReturn: true, note: 'x' }))).toMatchObject({ type: 'forbidden' });
    expect(err(await markNotReturn(f.deps, f.ctx, { entryId: payment.id, notReturn: true, note: '  ' }))).toMatchObject({ type: 'validation' });
    expect(err(await markNotReturn(f.deps, f.ctx, { entryId: 'unbekannt', notReturn: true, note: 'x' }))).toMatchObject({ type: 'notFound' });
    const draft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-12', text: 'Entwurf', moneyLines: [{ accountId: f.bank.id, amountCents: -100 }], allocationLines: [{ categoryId: f.categoryByKey('program-costs').id, amountCents: -100, contactId: f.erika.id }] }));
    expect(err(await markNotReturn(f.deps, f.ctx, { entryId: draft.id, notReturn: true, note: 'x' }))).toMatchObject({ type: 'conflict', code: 'entryNotFinal' });

    unwrap(await markNotReturn(f.deps, f.ctx, { entryId: payment.id, notReturn: true, note: 'Honorar Vortrag Erika Beispiel' }));
    const log = f.deps.db.select().from(schema.auditLog).all().filter((e) => e.action === 'finance.entry.notReturn');
    expect(log).toHaveLength(1);
    expect(JSON.parse(log[0]!.after as string)).toEqual({ entryId: payment.id, notReturn: true });
    expect(JSON.stringify(log)).not.toContain('Honorar');
  });
});

describe('N2: a payment on a certifiable category is a return by definition', () => {
  it('refuses the mark „is not a return“ with the remedy to link it to the donation', async () => {
    const f = await donationFixture();
    await f.donate({ cents: 20000 });
    const payment = await payOut(f, { cents: 5000 }); // Geldspenden, negativ
    expect(err(await markNotReturn(f.deps, f.ctx, { entryId: payment.id, notReturn: true, note: 'keine Rückgabe' }))).toMatchObject({ type: 'conflict', code: 'notReturnOnCertifiableCategory', messageKey: 'finance.errors.notReturnOnCertifiableCategory' });
    expect(unwrap(await getEntry(f.deps, f.ctx, { id: payment.id })).notReturn).toBeNull();
  });

  it('finalizing a negative line on a certifiable category without origin gives a notice, not a block', async () => {
    const f = await donationFixture();
    const gift = await f.donate({ cents: 20000 });
    expect(await payOut(f, { cents: 5000 })).toMatchObject({ status: 'final', notices: ['returnWithoutOrigin'] });
    expect((await f.giveBack(gift.line.id, 1000)).entry.notices).toEqual([]);
    expect((await payOut(f, { cents: 3000, categoryKey: 'program-costs' })).notices).toEqual([]);
  });
});

describe('N4: the checks name every blocking entry', () => {
  it('returnDraftPending names the return drafts, not the donation — all of them', async () => {
    const f = await donationFixture();
    const gift = await f.donate({ cents: 5000 });
    const draft = (date: string, cents: number) =>
      saveDraft(f.deps, f.ctx, { entryDate: date, text: 'Rückgabe', moneyLines: [{ accountId: f.bank.id, amountCents: -cents }], allocationLines: [{ categoryId: f.donations.id, amountCents: -cents, contactId: f.erika.id, originLineId: gift.line.id }] });
    const first = unwrap(await draft('2026-03-12', 1000));
    const second = unwrap(await draft('2026-03-14', 2000));
    const res = unwrap(await checkConfirmable(f.deps, f.ctx, { lineIds: [gift.line.id] }));
    expect(check(res, 'returnDraftPending')).toMatchObject({
      detail: {
        entryNumber: null,
        entries: [
          { entryId: first.id, entryNumber: null, entryDate: '2026-03-12', amountCents: -1000, href: `/finance/entries/${first.id}` },
          { entryId: second.id, entryNumber: null, entryDate: '2026-03-14', amountCents: -2000, href: `/finance/entries/${second.id}` },
        ],
      },
      remedy: { href: `/finance/entries/${first.id}`, labelKey: 'openReturnDraft' },
    });
    expect(JSON.stringify(check(res, 'returnDraftPending').detail)).not.toContain(String(gift.entry.number));
  });

  it('possibleReturnWithoutOrigin names every suspicious payment', async () => {
    const f = await donationFixture();
    const gift = await f.donate({ cents: 20000 });
    const a = await payOut(f, { cents: 5000, date: '2026-03-12' });
    const b = await payOut(f, { cents: 3000, date: '2026-03-20' });
    const res = unwrap(await checkConfirmable(f.deps, f.ctx, { lineIds: [gift.line.id] }));
    expect(check(res, 'possibleReturnWithoutOrigin')).toMatchObject({
      detail: {
        entryNumber: a.number,
        entries: [
          { entryId: a.id, entryNumber: a.number, entryDate: '2026-03-12', amountCents: -5000, href: `/finance/entries/${a.id}` },
          { entryId: b.id, entryNumber: b.number, entryDate: '2026-03-20', amountCents: -3000, href: `/finance/entries/${b.id}` },
        ],
      },
      remedy: { href: `/finance/entries/${a.id}`, labelKey: 'openEntry' },
    });
  });
});
