import { unwrap, writeSettingInternal } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { documents } from '@kompass/module-dms';
import { FINANCE_PERMISSIONS, financeSepaPrenotifications } from '@kompass/module-finance';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { previewDunningRun } from '../src/dunning';
import { setFeeAgreement } from '../src/fee-agreement';
import { feesForMembership, listFees } from '../src/fees';
import { previewRecalculation } from '../src/fee-recalc';
import { issueMemberLetterInternal } from '../src/letters/issue';
import { membersModule } from '../src/manifest';
import { admitMember, recordApplication } from '../src/memberships';
import { memberFeeCharges } from '../src/schema';
import { addressedPerson, auditOf, enteredOn, MEMBERS_PERMISSIONS, setupFees } from './helpers';

// TEST_NOW: 2026-10-18 — Plan N1 Task 2, Entscheidung E3 (M7): Der Beitrag hält seinen Zahlweg fest.
const NOW = '2026-10-18T08:00:00.000Z';
const IBAN = 'DE44999999990532013000';

async function setup(opts: { letter?: boolean } = {}) {
  const env = await setupFees({ now: NOW, validFrom: '2026-01-01', permissions: [...MEMBERS_PERMISSIONS, ...FINANCE_PERMISSIONS, 'dms.view'] });
  env.deps.db.transaction((tx) => {
    writeSettingInternal(tx, env.deps, systemContext(), 'organization.name', 'Musterverein e.V.');
    writeSettingInternal(tx, env.deps, systemContext(), 'organization.iban', 'DE23999999990000202051');
    writeSettingInternal(tx, env.deps, systemContext(), 'finance.sepa.creditorId', 'DE98ZZZ09999999999');
  });
  const contactId = await addressedPerson(env.deps, { lastName: 'Wechsel' });
  const applied = unwrap(await recordApplication(env.deps, env.ctx, { contactId, typeId: env.types.supporting, appliedOn: '2026-09-20' }));
  // Fördermitglied ab 01.10.: Beiträge Oktober, November, Dezember (je 10,00 €, fällig am Ersten); per Überweisung.
  const member = unwrap(await admitMember(env.deps, env.ctx, { membershipId: applied.id, admittedOn: '2026-10-01', letter: opts.letter ?? true }));
  const charges = () => env.deps.db.select().from(memberFeeCharges).where(eq(memberFeeCharges.membershipId, member.id)).all().filter((c) => c.state === 'created').sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  const switchToDirectDebit = () => setFeeAgreement(env.deps, env.ctx, { membershipId: member.id, validFrom: '2026-11-01', paymentMethod: 'directDebit', iban: IBAN, debtorName: 'Erika Wechsel' });
  const sources = (until: string) => [...(membersModule.directDebitSources?.(env.deps, { until }) ?? [])];
  return { ...env, member, charges, switchToDirectDebit, sources };
}

describe('Zahlweg am Beitrag (E3, M7)', () => {
  it('a new fee takes the payment method of the agreement on its due day', async () => {
    const f = await setup();
    expect(f.charges().map((c) => [c.periodStart, c.paymentMethod])).toEqual([
      ['2026-10-01', 'transfer'],
      ['2026-11-01', 'transfer'],
      ['2026-12-01', 'transfer'],
    ]);
  });

  it('(a) the October fee with a transfer letter stays transfer after the switch; the run leaves it out, dunning reminds it', async () => {
    const f = await setup();
    unwrap(await f.switchToDirectDebit());
    const [october, november, december] = f.charges();
    expect([october!.paymentMethod, november!.paymentMethod, december!.paymentMethod]).toEqual(['transfer', 'directDebit', 'directDebit']);
    expect(f.sources('2026-12-31').map((s) => s.openItemId)).toEqual([november!.openItemId, december!.openItemId]);
    enteredOn(f.deps, '2026-09-25');
    const dunning = unwrap(await previewDunningRun(f.deps, f.ctx, { asOf: '2026-12-31' }));
    expect(dunning.ready.flatMap((r) => r.chargeIds)).toContain(october!.id);
  });

  it('(b) without a letter, open fees follow the switch as before', async () => {
    const f = await setup({ letter: false });
    unwrap(await f.switchToDirectDebit());
    expect(f.charges().map((c) => c.paymentMethod)).toEqual(['directDebit', 'directDebit', 'directDebit']);
    expect(f.sources('2026-12-31')).toHaveLength(3);
    expect(auditOf(f.deps, 'members.fees.paymentMethod').at(-1)!.params).toEqual({ memberNumber: f.member.memberNumber, count: 3 });
  });

  it('(c) the recalculation preview names the fee that stays transfer, with the date of the letter', async () => {
    const f = await setup();
    const plan = unwrap(await previewRecalculation(f.deps, f.ctx, { membershipId: f.member.id, from: '2026-11-01', change: { kind: 'agreement', paymentMethod: 'directDebit' } }));
    const october = f.charges()[0]!;
    const letter = f.deps.db.select().from(documents).where(eq(documents.typeKey, 'member-admission')).get()!;
    expect(plan.transferKept).toEqual([{ chargeId: october.id, periodStart: '2026-10-01', documentId: letter.id, documentNumber: letter.number, documentDate: '2026-10-18' }]);
    // Die Vorschau schreibt nichts.
    expect(f.charges().map((c) => c.paymentMethod)).toEqual(['transfer', 'transfer', 'transfer']);
  });

  it('(d) the fee notice splits the fees by payment method: transfer block for transfer fees, collections for direct debit', async () => {
    const f = await setup();
    unwrap(await f.switchToDirectDebit());
    const issued = unwrap(await issueMemberLetterInternal(f.deps, f.ctx, { kind: 'feeNotice', membershipId: f.member.id, data: { year: 2026 } }));
    const input = JSON.parse(f.deps.db.select().from(documents).where(eq(documents.id, issued.documentId)).get()!.inputSnapshot!).input;
    expect(input.transfer).toMatchObject({ reference: `Beitrag 2026-10 Mitglied ${f.member.memberNumber}` });
    // Heute 18.10., Frist 14 Tage: Einzug November frühestens am 02.11. (Montag), Dezember am 01.12.; Oktober per
    // Überweisung bis Briefdatum plus Zahlungsziel.
    expect(input.table.rows).toEqual([
      ['2026-10', 'bis 01.11.2026', '10,00\u00a0€'],
      ['2026-11', 'Einzug am 02.11.2026', '10,00\u00a0€'],
      ['2026-12', 'Einzug am 01.12.2026', '10,00\u00a0€'],
    ]);
    expect((input.outro as string[]).join(' ')).toContain('SEPA-Lastschrift');
    const plan = f.deps.db.select().from(financeSepaPrenotifications).where(eq(financeSepaPrenotifications.documentId, issued.documentId)).get()!.plan;
    expect(plan).toEqual([
      { dueOn: '2026-11-02', amountCents: 1000, remittance: `Beitrag 2026-11 Mitglied ${f.member.memberNumber}` },
      { dueOn: '2026-12-01', amountCents: 1000, remittance: `Beitrag 2026-12 Mitglied ${f.member.memberNumber}` },
    ]);
  });

  it('(e) back to transfer: preview and result name the fees announced as collections, with the letter (R4)', async () => {
    const f = await setup();
    unwrap(await f.switchToDirectDebit());
    const notice = unwrap(await issueMemberLetterInternal(f.deps, f.ctx, { kind: 'feeNotice', membershipId: f.member.id, data: { year: 2026 } }));
    const doc = f.deps.db.select().from(documents).where(eq(documents.id, notice.documentId)).get()!;
    const [, november, december] = f.charges();
    const announced = [
      { chargeId: november!.id, periodStart: '2026-11-01', documentId: doc.id, documentNumber: doc.number, documentDate: '2026-10-18' },
      { chargeId: december!.id, periodStart: '2026-12-01', documentId: doc.id, documentNumber: doc.number, documentDate: '2026-10-18' },
    ];
    const plan = unwrap(await previewRecalculation(f.deps, f.ctx, { membershipId: f.member.id, from: '2026-11-01', change: { kind: 'agreement', paymentMethod: 'transfer' } }));
    expect(plan.debitAnnounced).toEqual(announced);
    const set = unwrap(await setFeeAgreement(f.deps, f.ctx, { membershipId: f.member.id, validFrom: '2026-11-01', paymentMethod: 'transfer' }));
    expect(set).toMatchObject({ paymentMethod: 'transfer', debitAnnounced: announced, transferKept: [] });
    expect(f.charges().map((c) => c.paymentMethod)).toEqual(['transfer', 'transfer', 'transfer']);
  });

  it('(f) the result of setting the agreement names the fees that stay transfer (R16)', async () => {
    const f = await setup();
    const set = unwrap(await f.switchToDirectDebit());
    const letter = f.deps.db.select().from(documents).where(eq(documents.typeKey, 'member-admission')).get()!;
    expect(set.transferKept).toEqual([{ chargeId: f.charges()[0]!.id, periodStart: '2026-10-01', documentId: letter.id, documentNumber: letter.number, documentDate: '2026-10-18' }]);
    expect(set.debitAnnounced).toEqual([]);
  });

  it('(g) fee lists show the payment method of each fee (R16)', async () => {
    const f = await setup();
    unwrap(await f.switchToDirectDebit());
    expect(unwrap(await feesForMembership(f.deps, f.ctx, f.member.id)).map((v) => [v.periodStart, v.paymentMethod]).sort()).toEqual([
      ['2026-10-01', 'transfer'],
      ['2026-11-01', 'directDebit'],
      ['2026-12-01', 'directDebit'],
    ]);
    expect(unwrap(await listFees(f.deps, f.ctx, { year: 2026 })).items.map((v) => v.paymentMethod).sort()).toEqual(['directDebit', 'directDebit', 'transfer']);
  });
});
