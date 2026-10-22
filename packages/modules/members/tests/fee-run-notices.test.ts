import { unwrap, writeSettingInternal, type CallContext } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { documents } from '@kompass/module-dms';
import { FINANCE_PERMISSIONS, financeSepaPrenotifications, prenotificationCovers } from '@kompass/module-finance';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { setFeeAgreement } from '../src/fee-agreement';
import { continueFeeRun, previewFeeRun, startFeeRun } from '../src/fee-run';
import { admitMember } from '../src/memberships';
import { runDispatchState, runPrintPdf } from '../src/run-dispatch';
import { memberRunLetters } from '../src/schema';
import { addressedPerson, MEMBERS_PERMISSIONS, setupFees, type MembersDeps } from './helpers';

const NOW = '2026-11-15T08:00:00.000Z';
const fail = <T>(res: { ok: boolean; error?: T }) => (res.ok ? null : res.error);

/** Ein Überweiser und ein Lastschrift-Zahler (Mandat vorbereitet), Beitragsordnung ab 2027. */
async function setup(opts: { transferAddress?: boolean } = {}) {
  const env = await setupFees({ now: NOW, permissions: [...MEMBERS_PERMISSIONS, 'dms.view', ...FINANCE_PERMISSIONS] });
  const { deps, ctx, types } = env;
  const transfer = unwrap(await admitMember(deps, ctx, { contactId: await addressedPerson(deps, { lastName: 'Ueberweiser', address: opts.transferAddress ?? true }), typeId: types.regular, admittedOn: '2026-01-01' }));
  const debit = unwrap(await admitMember(deps, ctx, { contactId: await addressedPerson(deps, { lastName: 'Lastschrift' }), typeId: types.regular, admittedOn: '2026-01-01' }));
  unwrap(await setFeeAgreement(deps, ctx, { membershipId: debit.id, validFrom: '2027-01-01', paymentMethod: 'directDebit', iban: 'DE44999999990532013000', debtorName: 'Erika Lastschrift' }));
  return { ...env, transfer, debit };
}

async function runAll(deps: MembersDeps, ctx: CallContext, start: Record<string, unknown>) {
  const run = unwrap(await startFeeRun(deps, ctx, { year: 2027, ...start }));
  let view = run;
  while (view.status === 'running') view = unwrap(await continueFeeRun(deps, ctx, { runId: run.id, max: 50 }));
  return view;
}

const lettersOf = (deps: MembersDeps, runId: string) => deps.db.select().from(memberRunLetters).where(eq(memberRunLetters.runRef, `membersFeeRun:${runId}`)).all();

describe('Beitragsmitteilung im Beitragslauf', () => {
  it('default directDebitOnly: the direct debit payer gets the notice, which is also the prenotification', async () => {
    const { deps, ctx, transfer, debit } = await setup();
    const run = await runAll(deps, ctx, {});
    expect(run).toMatchObject({ status: 'done', notices: 'directDebitOnly', noticesIssued: 1 });
    const letters = lettersOf(deps, run.id);
    expect(letters.map((l) => l.membershipId)).toEqual([debit.id]);
    expect(letters.map((l) => l.membershipId)).not.toContain(transfer.id);
    const doc = deps.db.select().from(documents).where(eq(documents.id, letters[0]!.documentId)).get()!;
    expect(doc).toMatchObject({ typeKey: 'member-fee-notice', subject: 'Mitgliedsbeitrag 2027' });
    // Fällig am 01.01.2027 (Feiertag, dann Wochenende): Brief und Plan nennen Montag, 04.01.2027 (Review Focus 2, E1).
    const row = deps.db.select().from(financeSepaPrenotifications).where(eq(financeSepaPrenotifications.documentId, doc.id)).get()!;
    expect(row.plan).toEqual([{ dueOn: '2027-01-04', amountCents: 1200, remittance: `Beitrag 2027 Mitglied ${debit.memberNumber}` }]);
    expect(JSON.parse(doc.inputSnapshot!).input.table.rows).toEqual([['2027', 'Einzug am 04.01.2027', '12,00\u00a0€']]);
    expect(prenotificationCovers(deps, row.mandateId, 1200, '2027-01-04', 14)).toBe(true);
    expect(prenotificationCovers(deps, row.mandateId, 1200, '2027-01-05', 14)).toBe(false);
    // Der Versand-Schritt kennt den Lauf.
    expect(unwrap(await runDispatchState(deps, ctx, { runRef: `membersFeeRun:${run.id}` })).post).toHaveLength(1);
  });

  it('an account holder other than the member: the separate prenotification is in the dispatch plan of the run, by the holder (R5), and names what for (R11)', async () => {
    const { deps, ctx, types } = await setup();
    const all: CallContext = { ...ctx, permissions: new Set([...ctx.permissions, 'dms.create', 'dms.file']) };
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'finance.sepa.creditorId', 'DE98ZZZ09999999999'));
    const kim = unwrap(await admitMember(deps, all, { contactId: await addressedPerson(deps, { lastName: 'Kind' }), typeId: types.regular, admittedOn: '2026-01-01' }));
    const holder = await addressedPerson(deps, { lastName: 'Inhaber', email: 'inhaber@example.org' });
    unwrap(await setFeeAgreement(deps, all, { membershipId: kim.id, validFrom: '2027-01-01', paymentMethod: 'directDebit', iban: 'DE78999999990000300001', debtorName: 'Erika Inhaber', payerContactId: holder }));
    const run = await runAll(deps, all, {});
    const letters = lettersOf(deps, run.id).filter((l) => l.membershipId === kim.id);
    expect(letters).toHaveLength(2);
    const notice = letters.find((l) => l.contactId === holder)!;
    expect(deps.db.select().from(documents).where(eq(documents.id, notice.documentId)).get()!.typeKey).toBe('sepa-prenotification');
    const state = unwrap(await runDispatchState(deps, all, { runRef: `membersFeeRun:${run.id}` }));
    expect([...state.mail, ...state.post].find((r) => r.documentId === notice.documentId)).toMatchObject({ name: 'Erika Inhaber' });
    expect(state.done).toBe(false);
    // R11: je Zeile der Verwendungszweck (der Brieftext folgt aus dem Plan, `prenotificationPlanBody`).
    expect(deps.db.select().from(financeSepaPrenotifications).where(eq(financeSepaPrenotifications.documentId, notice.documentId)).get()!.plan).toEqual([
      { dueOn: '2027-01-04', amountCents: 1200, remittance: `Beitrag 2027 Mitglied ${kim.memberNumber}` },
    ]);
  });

  /**
   * Backlog 78 (Retest U12): Die Ankündigung an einen fremden Kontoinhaber ist ein Finanzdokument. Eine Rolle ohne
   * Finanzrechte versendet die eigenen Briefe des Laufs; die Ankündigung zählt sie nur, statt am ganzen Plan zu scheitern.
   */
  describe('role without finance rights (78)', () => {
    async function withHolder() {
      const env = await setup();
      const all: CallContext = { ...env.ctx, permissions: new Set([...env.ctx.permissions, 'dms.create', 'dms.file']) };
      const members: CallContext = { ...env.ctx, permissions: new Set([...MEMBERS_PERMISSIONS, 'dms.view', 'dms.create', 'dms.file']) };
      env.deps.db.transaction((tx) => writeSettingInternal(tx, env.deps, systemContext(), 'finance.sepa.creditorId', 'DE98ZZZ09999999999'));
      const kim = unwrap(await admitMember(env.deps, all, { contactId: await addressedPerson(env.deps, { lastName: 'Kind' }), typeId: env.types.regular, admittedOn: '2026-01-01' }));
      const holder = await addressedPerson(env.deps, { lastName: 'Inhaber' });
      unwrap(await setFeeAgreement(env.deps, all, { membershipId: kim.id, validFrom: '2027-01-01', paymentMethod: 'directDebit', iban: 'DE78999999990000300001', debtorName: 'Erika Inhaber', payerContactId: holder }));
      return { ...env, all, members, kim, holder };
    }

    it('the dispatch plan shows the own letters and counts the prenotification it may not read', async () => {
      const { deps, all, members, holder, kim } = await withHolder();
      const run = await runAll(deps, all, {});
      const runRef = `membersFeeRun:${run.id}`;
      const notice = lettersOf(deps, run.id).find((l) => l.contactId === holder)!;
      const state = unwrap(await runDispatchState(deps, members, { runRef }));
      const rows = [...state.mail, ...state.post];
      expect(rows.map((r) => r.documentId)).not.toContain(notice.documentId);
      expect(rows.some((r) => r.membershipId === kim.id)).toBe(true);
      expect(state.restricted).toBe(1);
      // Wer Finanzrechte hat, sieht die Ankündigung wie bisher in der Gruppe ihres Wegs.
      const full = unwrap(await runDispatchState(deps, all, { runRef }));
      expect(full.restricted).toBe(0);
      expect([...full.mail, ...full.post].map((r) => r.documentId)).toContain(notice.documentId);
    });

    it('printing leaves the prenotification out for that role', async () => {
      const { deps, all, members } = await withHolder();
      const run = await runAll(deps, all, {});
      const runRef = `membersFeeRun:${run.id}`;
      const state = unwrap(await runDispatchState(deps, members, { runRef }));
      expect(unwrap(await runPrintPdf(deps, members, { runRef })).count).toBe(state.post.length);
      expect(unwrap(await runPrintPdf(deps, all, { runRef })).count).toBe(state.post.length + 1);
    });

    it('a run started by that role records the prenotification it could not issue', async () => {
      const { deps, members, kim } = await withHolder();
      const run = await runAll(deps, members, {});
      expect(run.status).toBe('done');
      expect(run.noticeRefused).toEqual([{ membershipId: kim.id, code: 'forbidden', letter: 'prenotification' }]);
    });
  });

  it('all: transfer payers get one too', async () => {
    const all = await setup();
    const runAllNotices = await runAll(all.deps, all.ctx, { notices: 'all' });
    expect(lettersOf(all.deps, runAllNotices.id).map((l) => l.membershipId).sort()).toEqual([all.transfer.id, all.debit.id].sort());
  });

  it('a notice that cannot be issued does not hold up the run', async () => {
    const { deps, ctx, transfer } = await setup({ transferAddress: false });
    const run = await runAll(deps, ctx, { notices: 'all' });
    expect(run.status).toBe('done');
    expect(run.noticeRefused).toEqual([{ membershipId: transfer.id, code: 'addressMissing' }]);
    expect(lettersOf(deps, run.id)).toHaveLength(1);
  });

  it('the preview warns when the first collection is closer than the prenotification period', async () => {
    const { deps, ctx, debit } = await setup();
    deps.clock.set('2026-12-25T08:00:00.000Z');
    const preview = unwrap(await previewFeeRun(deps, ctx, { year: 2027 }));
    expect(preview.prenotificationLate).toEqual([{ membershipId: debit.id, memberNumber: debit.memberNumber, firstDueOn: '2027-01-01' }]);
    deps.clock.set(NOW);
    expect(unwrap(await previewFeeRun(deps, ctx, { year: 2027 })).prenotificationLate).toEqual([]);
  });

  it('refuses an unknown notices option', async () => {
    const { deps, ctx } = await setup();
    expect(fail(await startFeeRun(deps, ctx, { year: 2027, notices: 'some' }))).toMatchObject({ type: 'validation' });
    // `none` gibt es nicht: Lastschrift-Zahler bekämen die Mitteilung trotzdem (Entscheid F3).
    expect(fail(await startFeeRun(deps, ctx, { year: 2027, notices: 'none' }))).toMatchObject({ type: 'validation' });
  });
});
