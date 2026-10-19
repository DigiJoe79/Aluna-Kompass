import { fixedClock, schema, unwrap, type CallContext } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { eq, like } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { amendMandate, endMandate, mandateInOpenRunInternal } from '../src/direct-debit/mandates';
import { endPledge, getPledge, savePledge } from '../src/direct-debit/pledges';
import { collectionWindow, createDirectDebitRun, earliestCoveredDay, getCollectionWindow, submitWindowInternal, type DirectDebitPreviewItem, getDirectDebitRun, listDirectDebitRuns, previewDirectDebitRun, removeRunItem } from '../src/direct-debit/runs';
import { issuePrenotification } from '../src/direct-debit/prenotifications';
import { financeDirectDebitItems, financePledges, financeSepaMandates } from '../src/schema';
import { allowHumanOnlyOverMcp } from './helpers';
import { directDebitFixture, IBANS } from './direct-debit-fixture';

// Uhr: Dienstag, 20.10.2026 — Fälligkeitstage 22.10. (zwei Bankarbeitstage) bis 20.10.2027 (ein Jahr).
const fail = <T>(res: { ok: boolean; error?: T }) => (res.ok ? null : res.error);
const asMcp = (ctx: CallContext): CallContext => ({ ...ctx, channel: 'mcp' });

/** Drei Beiträge zum 30.10.: angekündigt mit aktivem Mandat, mit vorbereitetem Mandat, ohne Ankündigung. */
async function scene() {
  const f = await directDebitFixture();
  const ok = await f.payer('Pünktlich');
  const pending = await f.payer('Vorbereitet', { signedOn: null });
  const late = await f.payer('Spät');
  const okItem = await f.fee(ok, 1200, '2026-10-30');
  const pendingItem = await f.fee(pending, 1200, '2026-10-30');
  const lateItem = await f.fee(late, 1200, '2026-10-30');
  for (const p of [ok, pending]) f.announce(p.mandateId, [{ dueOn: '2026-10-30', amountCents: 1200 }]);
  // Zu spät angekündigt: ausgestellt am 20.10., zehn Tage vor dem 30.10.
  f.announce(late.mandateId, [{ dueOn: '2026-10-30', amountCents: 1200 }], '2026-10-20');
  return { ...f, ok, pending, late, okItem, pendingItem, lateItem };
}

describe('collectionWindow', () => {
  it('runs from the lead in bank business days to the last business day one year ahead', async () => {
    const f = await directDebitFixture();
    expect(collectionWindow(f.deps, '2026-10-20')).toEqual({ earliest: '2026-10-22', latest: '2027-10-20' });
    // Am Samstag eingereicht zählt ab Montag: Montag plus zwei Bankarbeitstage; der 24.10.2027 ist ein Sonntag.
    expect(collectionWindow(f.deps, '2026-10-24')).toEqual({ earliest: '2026-10-28', latest: '2027-10-22' });
    // Über Weihnachten: 25. und 26.12. und Neujahr sind keine Bankarbeitstage.
    expect(collectionWindow(f.deps, '2026-12-23')).toEqual({ earliest: '2026-12-28', latest: '2027-12-23' });
    f.write('finance.sepa.leadBusinessDays', 1);
    // Die frühestens-Frist der Bank begrenzt die Einreichung, nicht den Fälligkeitstag.
    f.write('finance.sepa.maxLeadDays', 7);
    expect(collectionWindow(f.deps, '2026-10-20')).toEqual({ earliest: '2026-10-21', latest: '2027-10-20' });
  });

  it('getCollectionWindow lists every bank business day in the window — and only those (Handoff 2a § 1.2)', async () => {
    const f = await directDebitFixture();
    const window = unwrap(await getCollectionWindow({ ...f.deps, clock: fixedClock('2026-12-23T08:00:00.000Z') }, f.ctx, {}));
    expect(window).toMatchObject({ today: '2026-12-23', earliest: '2026-12-28', latest: '2027-12-23' });
    expect(window.days.slice(0, 7)).toEqual(['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-04', '2027-01-05', '2027-01-06']);
    expect(window.days.at(-1)).toBe('2027-12-23');
    // Karfreitag und Ostermontag 2027 und Wochenenden fehlen.
    for (const closed of ['2027-03-26', '2027-03-29', '2027-01-09']) expect(window.days).not.toContain(closed);
  });

  it('Joes Fall: Ankündigung heute für in 14 Tagen — der 02.11. ist wählbar, ob die Bank 14 oder 5 Tage vorher annimmt', async () => {
    const f = await directDebitFixture();
    const sunday = { ...f.deps, clock: fixedClock('2026-10-18T08:00:00.000Z') };
    const p = await f.payer('Vorausschau');
    await f.fee(p, 1200, '2026-11-02');
    f.announce(p.mandateId, [{ dueOn: '2026-11-02', amountCents: 1200 }], '2026-10-18');
    const fourteen = unwrap(await getCollectionWindow(sunday, f.ctx, {}));
    expect(fourteen.days).toContain('2026-11-02');
    expect(unwrap(await previewDirectDebitRun(sunday, f.ctx, { collectionDate: '2026-11-02' })).included).toHaveLength(1);
    f.write('finance.sepa.maxLeadDays', 5);
    const five = unwrap(await getCollectionWindow(sunday, f.ctx, {}));
    expect(five.days).toEqual(fourteen.days);
    expect(five.days.filter((d) => d >= '2026-11-02' && d <= '2026-12-31').length).toBeGreaterThan(40);
  });
});

describe('submitWindowInternal', () => {
  it('from maxLeadDays calendar days before (next bank business day, or today once open) to leadBusinessDays before', async () => {
    const f = await directDebitFixture();
    // 13.11. minus 14 Tage = 30.10. (Freitag); zwei Bankarbeitstage vorher = 11.11.
    expect(submitWindowInternal(f.deps, '2026-11-13', '2026-10-20')).toEqual({ submitFrom: '2026-10-30', submitBy: '2026-11-11' });
    // 16.11. minus 14 Tage = 01.11. (Sonntag) → Montag, 02.11.
    expect(submitWindowInternal(f.deps, '2026-11-16', '2026-10-20')).toEqual({ submitFrom: '2026-11-02', submitBy: '2026-11-12' });
    // Schon offen: frühestens heute.
    expect(submitWindowInternal(f.deps, '2026-10-30', '2026-10-20')).toEqual({ submitFrom: '2026-10-20', submitBy: '2026-10-28' });
    f.write('finance.sepa.maxLeadDays', 5);
    expect(submitWindowInternal(f.deps, '2026-11-13', '2026-10-20')).toEqual({ submitFrom: '2026-11-09', submitBy: '2026-11-11' });
  });
});

describe('earliestCoveredDay', () => {
  const item = (coverOn: string) => ({ coverOn }) as DirectDebitPreviewItem;
  const window = { earliest: '2026-10-22', latest: '2027-10-20' };
  it('the first bank business day from noticeCoversFrom and every coverOn, after the chosen day and in the window', () => {
    const late = (...days: string[]) => [{ reason: 'noticeLate' as const, items: days.map(item) }];
    expect(earliestCoveredDay({ collectionDate: '2026-10-30', noticeCoversFrom: '2026-11-03', excluded: late('2026-10-30') }, window)).toBe('2026-11-03');
    // Ein Samstag rückt auf Montag; ein späteres coverOn zählt.
    expect(earliestCoveredDay({ collectionDate: '2026-10-30', noticeCoversFrom: '2026-11-07', excluded: late('2026-10-30') }, window)).toBe('2026-11-09');
    expect(earliestCoveredDay({ collectionDate: '2026-10-30', noticeCoversFrom: '2026-11-03', excluded: late('2026-10-30', '2026-11-05') }, window)).toBe('2026-11-05');
    // F8: Deckt eine heute ausgestellte Ankündigung den gewählten Tag selbst, ist es dieser Tag („heute ankündigen“).
    expect(earliestCoveredDay({ collectionDate: '2026-11-03', noticeCoversFrom: '2026-11-03', excluded: late('2026-11-03') }, window)).toBe('2026-11-03');
    expect(earliestCoveredDay({ collectionDate: '2026-11-04', noticeCoversFrom: '2026-11-03', excluded: late('2026-11-04') }, window)).toBe('2026-11-04');
    // Nichts zu spät oder außerhalb des Fensters: kein Ausweg.
    expect(earliestCoveredDay({ collectionDate: '2026-10-30', noticeCoversFrom: '2026-11-03', excluded: [] }, window)).toBeNull();
    expect(earliestCoveredDay({ collectionDate: '2026-10-30', noticeCoversFrom: '2027-11-03', excluded: late('2026-10-30') }, window)).toBeNull();
  });

  it('the preview names it for the late notices, with its submission window', async () => {
    const f = await scene();
    const preview = unwrap(await previewDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-10-30' }));
    expect(preview).toMatchObject({ noticeCoversFrom: '2026-11-03', noticeLateCoveredOn: '2026-11-03', submitFrom: '2026-10-20', submitBy: '2026-10-28' });
  });
});

describe('notice names the day of the debit (Plan N1 E1)', () => {
  it('after issuing a notice for noticeLateCoveredOn, the preview for that day covers the late items (g)', async () => {
    const f = await scene();
    const first = unwrap(await previewDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-10-30' }));
    const late = first.excluded.find((g) => g.reason === 'noticeLate')!.items;
    const day = first.noticeLateCoveredOn!;
    for (const i of late) unwrap(await issuePrenotification(f.deps, f.ctx, { mandateId: i.mandateId, plan: [{ dueOn: day, amountCents: i.amountCents }] }));
    const moved = unwrap(await previewDirectDebitRun(f.deps, f.ctx, { collectionDate: day }));
    // Die übrigen Posten waren für den 30.10. angekündigt — für den neuen Tag nicht mehr gedeckt (E1).
    const stillLate = moved.excluded.find((g) => g.reason === 'noticeLate')?.items ?? [];
    expect(stillLate.map((i) => i.sourceId)).not.toContain(f.lateItem);
    expect(moved.included.map((i) => i.sourceId)).toEqual(expect.arrayContaining(late.map((i) => i.sourceId)));
  });

  it('an overdue item is covered by a notice naming the collection day, not by one naming its due day (M6)', async () => {
    const f = await directDebitFixture();
    const p = await f.payer('Überfällig');
    await f.fee(p, 500, '2026-10-15');
    f.announce(p.mandateId, [{ dueOn: '2026-10-15', amountCents: 500 }]);
    const before = unwrap(await previewDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-11-02' }));
    expect(before.excluded).toMatchObject([{ reason: 'noticeLate', items: [{ coverOn: '2026-11-02', dueOn: '2026-10-15' }] }]);
    f.announce(p.mandateId, [{ dueOn: '2026-11-02', amountCents: 500 }], '2026-10-16');
    expect(unwrap(await previewDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-11-02' })).included).toHaveLength(1);
  });

  it('one announced debit covers one item: of two with the same amount, the newer is collected (E1 b)', async () => {
    const f = await directDebitFixture();
    const p = await f.payer('Doppelt');
    const older = await f.fee(p, 500, '2026-10-15');
    const newer = await f.fee(p, 500, '2026-11-02');
    f.announce(p.mandateId, [{ dueOn: '2026-11-02', amountCents: 500 }]);
    const preview = unwrap(await previewDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-11-02' }));
    expect(preview.included.map((i) => i.sourceId)).toEqual([newer]);
    expect(preview.excluded).toMatchObject([{ reason: 'noticeLate', items: [{ sourceId: older }] }]);
  });

  it('a pledge rate on a Saturday, announced by the pledge, is covered on the Monday (h)', async () => {
    const f = await directDebitFixture();
    const p = await f.payer('Spenderin');
    unwrap(await savePledge(f.deps, f.ctx, { contactId: p.contactId, amountCents: 1500, interval: 'monthly', firstDueOn: '2026-11-21', paymentMethod: 'directDebit', mandateId: p.mandateId }));
    f.announce(p.mandateId, [{ dueOn: '2026-11-21', amountCents: 1500 }]);
    expect(unwrap(await previewDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-11-23' })).included).toMatchObject([{ installmentOn: '2026-11-21' }]);
    expect(unwrap(await previewDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-11-24' })).excluded).toMatchObject([{ reason: 'noticeLate' }]);
  });
});

describe('previewDirectDebitRun', () => {
  it('refuses a day outside the window or not a bank business day and names the window (Review Focus 1)', async () => {
    const f = await scene();
    for (const collectionDate of ['2026-10-21', '2027-10-21', '2026-10-31', '2026-10-20']) {
      expect(fail(await previewDirectDebitRun(f.deps, f.ctx, { collectionDate })), collectionDate).toMatchObject({ code: 'invalidCollectionDate', params: { earliest: '2026-10-22', latest: '2027-10-20' } });
    }
    expect(fail(await previewDirectDebitRun(f.deps, f.ctx, { collectionDate: 'morgen' }))).toMatchObject({ type: 'validation' });
    expect(fail(await previewDirectDebitRun(f.deps, ctxWith(['contacts.read'], f.userId), { collectionDate: '2026-10-30' }))).toMatchObject({ type: 'forbidden' });
  });

  it('groups what is collected and what is not, with the reason (Review Focus 5)', async () => {
    const f = await scene();
    const preview = unwrap(await previewDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-10-30' }));
    expect(preview.included.map((i) => i.sourceId)).toEqual([f.okItem]);
    expect(preview.included[0]).toMatchObject({ source: 'openItem', mandateId: f.ok.mandateId, mandateReference: f.ok.reference, amountCents: 1200, dueOn: '2026-10-30', remittance: 'Beitrag 2026 Mitglied 0001', debtorName: 'Erika Pünktlich' });
    expect(preview.excluded.map((g) => [g.reason, g.items.map((i) => i.sourceId)])).toEqual([
      ['mandateInactive', [f.pendingItem]],
      ['noticeLate', [f.lateItem]],
    ]);
    expect(preview.totals).toEqual({ count: 1, sumCents: 1200 });
    expect(preview.accountId).toBe(f.bank.id);
  });

  it('a rate due on 02.11. goes into the run on 02.11., not into the one on 30.10.', async () => {
    const f = await directDebitFixture();
    const p = await f.payer('Spenderin');
    const pledge = unwrap(await savePledge(f.deps, f.ctx, { contactId: p.contactId, amountCents: 1500, interval: 'monthly', firstDueOn: '2026-11-02', paymentMethod: 'directDebit', mandateId: p.mandateId }));
    f.announce(p.mandateId, [{ dueOn: '2026-11-02', amountCents: 1500 }]);
    expect(unwrap(await previewDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-10-30' }))).toMatchObject({ included: [], excluded: [] });
    const preview = unwrap(await previewDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-11-02' }));
    expect(preview.included).toMatchObject([{ source: 'pledge', sourceId: pledge.pledge.id, installmentOn: '2026-11-02', dueOn: '2026-11-02', amountCents: 1500, remittance: 'Spende 2026-11' }]);
  });

  it('rates more than 30 days before the due day or before the pledge was created are missed, not late (L2 Nacharbeit 2)', async () => {
    const f = await directDebitFixture();
    const p = await f.payer('Spenderin');
    const january = { ...f.deps, clock: fixedClock('2026-01-10T08:00:00.000Z') };
    unwrap(await savePledge(january, f.ctx, { contactId: p.contactId, amountCents: 1500, interval: 'monthly', firstDueOn: '2026-01-15', paymentMethod: 'directDebit', mandateId: p.mandateId }));
    unwrap(await savePledge(january, f.ctx, { contactId: p.contactId, amountCents: 700, interval: 'monthly', firstDueOn: '2026-01-03', paymentMethod: 'directDebit', mandateId: p.mandateId }));
    // Angelegt erst im Oktober: die Rate vom 15.10. lag davor.
    unwrap(await savePledge({ ...f.deps, clock: fixedClock('2026-10-16T08:00:00.000Z') }, f.ctx, { contactId: p.contactId, amountCents: 300, interval: 'monthly', firstDueOn: '2026-01-15', paymentMethod: 'directDebit', mandateId: p.mandateId }));
    const preview = unwrap(await previewDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-11-02' }));
    const shown = [...preview.included, ...preview.excluded.flatMap((g) => g.items)].map((i) => `${i.installmentOn}:${i.amountCents}`).sort();
    // Zusage ab 15.01., Einzug zum 02.11.: nur Raten ab dem 03.10. (30 Tage vorher); die vom 03.10. gerade noch.
    expect(shown).toEqual(['2026-10-03:700', '2026-10-15:1500']);
  });

  it('a skipped rate and a pledge by transfer are not collected', async () => {
    const f = await directDebitFixture();
    const p = await f.payer('Spenderin');
    unwrap(await savePledge(f.deps, f.ctx, { contactId: p.contactId, amountCents: 1500, interval: 'monthly', firstDueOn: '2026-11-02', paymentMethod: 'transfer' }));
    const paused = unwrap(await savePledge(f.deps, f.ctx, { contactId: p.contactId, amountCents: 900, interval: 'monthly', firstDueOn: '2026-11-02', paymentMethod: 'directDebit', mandateId: p.mandateId }));
    f.deps.db.update(financePledges).set({ pausedFrom: '2026-11-01', pausedUntil: '2026-11-30' }).where(eq(financePledges.id, paused.pledge.id)).run();
    expect(unwrap(await previewDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-11-02' }))).toMatchObject({ included: [], excluded: [] });
  });

  it('needs the direct debit set up', async () => {
    const f = await scene();
    f.write('finance.sepa.enabled', false);
    expect(fail(await previewDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-10-30' }))).toMatchObject({ code: 'sepaNotReady' });
  });
});

describe('createDirectDebitRun', () => {
  it('holds only what can be collected, with a message id and one end-to-end id per item; audited with day, count and sum', async () => {
    const f = await scene();
    const run = unwrap(await createDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-10-30' }));
    expect(run).toMatchObject({ collectionDate: '2026-10-30', status: 'draft', accountId: f.bank.id, count: 1, sumCents: 1200, submitBy: '2026-10-28' });
    expect(run.messageId.length).toBeLessThanOrEqual(35);
    expect(run.items).toHaveLength(1);
    expect(run.items[0]).toMatchObject({ source: 'openItem', sourceId: f.okItem, mandateReference: f.ok.reference, amountCents: 1200, amended: false, removedAt: null });
    expect(run.items[0]!.endToEndId).toMatch(/^[A-Za-z0-9-]{1,35}$/);
    const audit = f.deps.db.select().from(schema.auditLog).where(like(schema.auditLog.action, 'finance.directDebit.%')).all();
    expect(audit.map((a) => [a.action, a.params])).toEqual([['finance.directDebit.create', JSON.stringify({ collectionOn: '2026-10-30', count: 1, sumCents: 1200 })]]);
    expect(JSON.stringify(audit)).not.toMatch(/DE\d{20}|Pünktlich/);
  });

  it('an item in a run that is not cancelled appears in no second one (Review Focus 2); nothing left is nothingToCollect', async () => {
    const f = await scene();
    unwrap(await createDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-10-30' }));
    const again = unwrap(await previewDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-10-30' }));
    expect(again.included).toEqual([]);
    expect(again.excluded.find((g) => g.reason === 'inOtherRun')?.items.map((i) => i.sourceId)).toEqual([f.okItem]);
    expect(fail(await createDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-11-02' }))).toMatchObject({ code: 'nothingToCollect', params: { date: '2026-11-02' } });
  });

  it('takes the pending amendment of the mandate into its first item', async () => {
    const f = await scene();
    unwrap(await amendMandate(f.deps, f.ctx, { mandateId: f.ok.mandateId, iban: IBANS[6], validFrom: '2026-10-15' }));
    await f.fee(f.ok, 300, '2026-10-29', 'Aufnahmebeitrag');
    f.announce(f.ok.mandateId, [{ dueOn: '2026-10-30', amountCents: 300 }]);
    const run = unwrap(await createDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-10-30' }));
    const rows = f.deps.db.select().from(financeDirectDebitItems).where(eq(financeDirectDebitItems.runId, run.id)).all();
    expect(rows.map((r) => r.amendment)).toEqual([{ originalIban: f.ok.iban, since: '2026-10-15' }, null]);
    expect(run.items.map((i) => i.amended)).toEqual([true, false]);
  });

  it('is human only, needs finance.directDebit, a valid day', async () => {
    const f = await scene();
    expect(fail(await createDirectDebitRun(f.deps, asMcp(f.ctx), { collectionDate: '2026-10-30' }))).toMatchObject({ code: 'humanOnly' });
    expect(fail(await createDirectDebitRun(f.deps, ctxWith(['finance.read'], f.userId), { collectionDate: '2026-10-30' }))).toMatchObject({ type: 'forbidden' });
    expect(fail(await createDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-10-21' }))).toMatchObject({ code: 'invalidCollectionDate' });
    allowHumanOnlyOverMcp(f.deps);
    expect((await createDirectDebitRun(f.deps, asMcp(f.ctx), { collectionDate: '2026-10-30' })).ok).toBe(true);
  });
});

describe('mandate and pledge in a run', () => {
  it('mandateInOpenRunInternal is true for a mandate in a created run; ending it is refused', async () => {
    const f = await scene();
    expect(mandateInOpenRunInternal(f.deps.db, f.ok.mandateId)).toBe(false);
    unwrap(await createDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-10-30' }));
    expect(mandateInOpenRunInternal(f.deps.db, f.ok.mandateId)).toBe(true);
    expect(mandateInOpenRunInternal(f.deps.db, f.late.mandateId)).toBe(false);
    expect(fail(await endMandate(f.deps, f.ctx, { mandateId: f.ok.mandateId, endedOn: '2026-10-20', reason: 'debtor' }))).toMatchObject({ code: 'mandateInOpenRun' });
  });

  it('a rate in a run shows as in the run, and ending the pledge before it is refused', async () => {
    const f = await directDebitFixture();
    const p = await f.payer('Spenderin');
    const pledge = unwrap(await savePledge(f.deps, f.ctx, { contactId: p.contactId, amountCents: 1500, interval: 'monthly', firstDueOn: '2026-11-02', paymentMethod: 'directDebit', mandateId: p.mandateId }));
    f.announce(p.mandateId, [{ dueOn: '2026-11-02', amountCents: 1500 }]);
    unwrap(await createDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-11-02' }));
    const rates = unwrap(await getPledge(f.deps, f.ctx, { id: pledge.pledge.id, from: '2026-11-01', to: '2026-12-31' })).rates;
    expect(rates.map((r) => [r.dueOn, r.state])).toEqual([['2026-11-02', 'inRun'], ['2026-12-02', 'expected']]);
    expect(fail(await endPledge(f.deps, f.ctx, { pledgeId: pledge.pledge.id, endedOn: '2026-10-31' }))).toMatchObject({ code: 'pledgeRateInRun', params: { dueOn: '2026-11-02', date: '2026-11-02' } });
    expect((await endPledge(f.deps, f.ctx, { pledgeId: pledge.pledge.id, endedOn: '2026-11-30' })).ok).toBe(true);
  });
});

describe('removeRunItem', () => {
  it('takes an item out; it shows again in the preview and the mandate is free', async () => {
    const f = await scene();
    const run = unwrap(await createDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-10-30' }));
    const after = unwrap(await removeRunItem(f.deps, f.ctx, { itemId: run.items[0]!.id }));
    expect(after).toMatchObject({ count: 0, sumCents: 0 });
    expect(after.items[0]!.removedAt).not.toBeNull();
    expect(mandateInOpenRunInternal(f.deps.db, f.ok.mandateId)).toBe(false);
    expect(unwrap(await previewDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-10-30' })).included.map((i) => i.sourceId)).toEqual([f.okItem]);
    expect(fail(await removeRunItem(f.deps, f.ctx, { itemId: run.items[0]!.id }))).toMatchObject({ code: 'runItemRemoved' });
    expect(fail(await removeRunItem(f.deps, f.ctx, { itemId: 'NOPE' }))).toMatchObject({ type: 'notFound' });
    expect(fail(await removeRunItem(f.deps, ctxWith(['finance.read'], f.userId), { itemId: run.items[0]!.id }))).toMatchObject({ type: 'forbidden' });
    const audit = f.deps.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'finance.directDebit.removeItem')).all();
    expect(audit.map((a) => a.params)).toEqual([JSON.stringify({ collectionOn: '2026-10-30' })]);
  });
});

describe('getDirectDebitRun and listDirectDebitRuns', () => {
  it('read the run with its items and list runs by year and status, newest first', async () => {
    const f = await scene();
    const run = unwrap(await createDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-10-30' }));
    const { hints: _hints, ...view } = run;
    expect(unwrap(await getDirectDebitRun(f.deps, f.ctx, { id: run.id }))).toEqual(view);
    expect(run.items[0]).toMatchObject({ returnId: null, returnStatus: null });
    expect(run).toMatchObject({ returns: 0, openReturns: 0, fileCreatedByUserId: null, submittedByUserId: null });
    expect(fail(await getDirectDebitRun(f.deps, f.ctx, { id: 'NOPE' }))).toMatchObject({ type: 'notFound' });
    const list = unwrap(await listDirectDebitRuns(f.deps, f.ctx, { year: 2026 }));
    expect(list).toMatchObject({ total: 1, items: [{ id: run.id, collectionDate: '2026-10-30', status: 'draft', count: 1, sumCents: 1200 }] });
    expect(unwrap(await listDirectDebitRuns(f.deps, f.ctx, { year: 2025 }))).toMatchObject({ total: 0, years: [2026] });
    expect(unwrap(await listDirectDebitRuns(f.deps, f.ctx, { status: 'submitted' })).total).toBe(0);
    expect(fail(await listDirectDebitRuns(f.deps, ctxWith(['contacts.read'], f.userId), {}))).toMatchObject({ type: 'forbidden' });
    // Die Mandate liegen fest: Ein angelegter Einzug ändert sie nicht.
    expect(f.deps.db.select().from(financeSepaMandates).where(eq(financeSepaMandates.id, f.ok.mandateId)).get()!.lastCollectedOn).toBeNull();
  });
});
