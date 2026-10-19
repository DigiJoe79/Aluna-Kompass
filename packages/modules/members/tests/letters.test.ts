import { newId, readSetting, unwrap, writeSettingInternal, type CallContext } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { contacts, createContact, setContactChannels } from '@kompass/module-contacts';
import { documentLinks, documents, documentTypes } from '@kompass/module-dms';
import { createAccount, FINANCE_PERMISSIONS, prepareMandate, financeAccounts, financeDirectDebitItems, financeDirectDebitReturns, financeDirectDebitRuns, financeSepaMandates, financeSepaPrenotifications, prenotificationCovers } from '@kompass/module-finance';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { countMembersAt } from '../src/census';
import { setFeeAgreement } from '../src/fee-agreement';
import { issueMemberCountCertificate } from '../src/letters/count';
import { issueMemberLetter, issueMemberLetterInternal } from '../src/letters/issue';
import { memberLetterTemplates } from '../src/letters/templates';
import { admitMember, recordApplication, recordResignation, rejectApplication } from '../src/memberships';
import { memberFeeCharges } from '../src/schema';
import { setNextMemberNumber } from '../src/types';
import { asMcp, auditOf, MEMBERS_PERMISSIONS, payOpenItem, setupFees, type MembersDeps } from './helpers';

const NOW = '2027-02-10T08:00:00.000Z';
const ORG_IBAN = 'DE23999999990000202051';
const fail = <T>(res: { ok: boolean; error?: T }) => (res.ok ? null : res.error);

/** Ein erfundener Kontakt mit Anschrift und, wenn gewünscht, E-Mail. */
async function contact(deps: MembersDeps, opts: { address?: boolean; email?: string; lastName?: string } = {}): Promise<string> {
  const ctx: CallContext = { ...systemContext(), permissions: new Set(['contacts.manage']) };
  const address = opts.address === false ? {} : { street: 'Lindenweg 4', postalCode: '12345', city: 'Beispielstadt' };
  const id = unwrap(await createContact(deps, ctx, { kind: 'person', salutation: 'Frau', firstName: 'Erika', lastName: opts.lastName ?? 'Beispiel', ...address })).id;
  if (opts.email) unwrap(await setContactChannels(deps, ctx, { id, channels: [{ kind: 'email', value: opts.email, isPrimary: true }] }));
  return id;
}

async function setup() {
  const env = await setupFees({ now: NOW, validFrom: '2027-01-01', permissions: [...MEMBERS_PERMISSIONS, ...FINANCE_PERMISSIONS] });
  env.deps.db.transaction((tx) => {
    writeSettingInternal(tx, env.deps, systemContext(), 'organization.name', 'Musterverein e.V.');
    writeSettingInternal(tx, env.deps, systemContext(), 'organization.iban', ORG_IBAN);
  });
  return env;
}

/** Die Eingabe, mit der ein Dokument ausgestellt wurde (Schnappschuss der Akte). */
const inputOf = (deps: MembersDeps, documentId: string) => JSON.parse(deps.db.select().from(documents).where(eq(documents.id, documentId)).get()!.inputSnapshot!).input;
/** Der Typst-Körper eines ausgestellten Briefs, wie die Vorlage ihn aus dem Schnappschuss baut. */
function bodyOf(deps: MembersDeps, documentId: string): string {
  const row = deps.db.select().from(documents).where(eq(documents.id, documentId)).get()!;
  const template = memberLetterTemplates.find((t) => t.key === row.templateKey)!;
  const built = template.build(inputOf(deps, documentId), { number: row.number!, issuedAt: NOW, issuedDay: '2027-02-10', organization: {}, theme: {} as never, logo: null } as never);
  return 'typst' in built.body ? built.body.typst : '';
}
const linksOf = (deps: MembersDeps, documentId: string) => deps.db.select().from(documentLinks).where(eq(documentLinks.documentId, documentId)).all().map((l) => [l.entityType, l.role]);

describe('Aufnahmebestätigung', () => {
  it('admitting an application issues the letter in area members, linked to membership and recipient, with the transfer block of the first fee', async () => {
    const { deps, ctx, types } = await setup();
    const contactId = await contact(deps);
    const applied = unwrap(await recordApplication(deps, ctx, { contactId, typeId: types.regular, appliedOn: '2027-01-20' }));
    const admitted = unwrap(await admitMember(deps, ctx, { membershipId: applied.id, admittedOn: '2027-02-01' }));
    expect(admitted.letter).toMatchObject({ documentId: expect.any(String) });
    const documentId = (admitted.letter as { documentId: string }).documentId;
    const doc = deps.db.select().from(documents).where(eq(documents.id, documentId)).get()!;
    expect(doc).toMatchObject({ typeKey: 'member-admission', phase: 'issued', direction: 'outgoing' });
    expect(deps.db.select().from(documentTypes).where(eq(documentTypes.key, 'member-admission')).get()).toMatchObject({ protectionArea: 'members', ownerModule: 'members' });
    expect(linksOf(deps, documentId)).toEqual(expect.arrayContaining([['membership', 'about'], ['contact', 'recipient']]));
    const input = inputOf(deps, documentId);
    expect(input.transfer).toMatchObject({ iban: ORG_IBAN, amount: '12,00\u00a0€', reference: `Beitrag 2027 Mitglied ${admitted.memberNumber}` });
    expect(input.transfer.qr).not.toBeNull();
    expect(input.recipient).toContain('Lindenweg 4');
    expect(bodyOf(deps, documentId)).toContain('#transfer-block(');
    expect(auditOf(deps, 'members.letter.issue').at(-1)!.params).toEqual({ memberNumber: admitted.memberNumber, kind: 'admission', documentNumber: doc.number });
  });

  it('the deadline is the letter day plus the payment term when the first fee is already due (Befund 2026-10-18)', async () => {
    const { deps, ctx, types } = await setup();
    const applied = unwrap(await recordApplication(deps, ctx, { contactId: await contact(deps), typeId: types.regular, appliedOn: '2027-01-20' }));
    const admitted = unwrap(await admitMember(deps, ctx, { membershipId: applied.id, admittedOn: '2027-02-01' }));
    // Fällig am 01.02.2027 (Beginn), Brief am 10.02.2027: Frist 24.02.2027, die Fälligkeit bleibt.
    const charge = deps.db.select().from(memberFeeCharges).where(eq(memberFeeCharges.membershipId, admitted.id)).all().find((c) => c.state === 'created')!;
    expect(charge.dueOn).toBe('2027-02-01');
    const input = inputOf(deps, (admitted.letter as { documentId: string }).documentId);
    expect(input.deadline).toBe('Bitte überweisen Sie den ersten Beitrag von 12,00\u00a0€ bis zum 24.02.2027.');
  });

  it('the deadline stays the due day when that is later than the letter day plus the payment term', async () => {
    const { deps, ctx, types } = await setup();
    const applied = unwrap(await recordApplication(deps, ctx, { contactId: await contact(deps), typeId: types.regular, appliedOn: '2027-01-20' }));
    const admitted = unwrap(await admitMember(deps, ctx, { membershipId: applied.id, admittedOn: '2027-02-01', joinedOn: '2027-04-01' }));
    const input = inputOf(deps, (admitted.letter as { documentId: string }).documentId);
    expect(input.deadline).toBe('Bitte überweisen Sie den ersten Beitrag von 12,00\u00a0€ bis zum 01.04.2027.');
  });

  it('by direct debit: mandate reference instead of the block, and the letter announces the first collections (one prenotification row, no second document)', async () => {
    const { deps, ctx, types } = await setup();
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'finance.sepa.creditorId', 'DE98ZZZ09999999999'));
    const contactId = await contact(deps);
    const member = unwrap(await admitMember(deps, ctx, { contactId, typeId: types.regular, admittedOn: '2027-01-01', letter: false }));
    unwrap(await setFeeAgreement(deps, ctx, { membershipId: member.id, validFrom: '2027-01-01', paymentMethod: 'directDebit', iban: 'DE44999999990532013000', debtorName: 'Erika Beispiel' }));
    const before = deps.db.select().from(documents).all().length;
    const issued = unwrap(await issueMemberLetterInternal(deps, ctx, { kind: 'admission', membershipId: member.id }));
    expect(deps.db.select().from(documents).all().length).toBe(before + 1);
    const input = inputOf(deps, issued.documentId);
    expect(input.transfer).toBeNull();
    const mandate = deps.db.select().from(financeSepaMandates).get()!;
    expect(JSON.stringify(input)).toContain(mandate.reference);
    const row = deps.db.select().from(financeSepaPrenotifications).where(eq(financeSepaPrenotifications.documentId, issued.documentId)).get()!;
    expect(row).toMatchObject({ mandateId: mandate.id });
    const charge = deps.db.select().from(memberFeeCharges).where(eq(memberFeeCharges.membershipId, member.id)).all().find((c) => c.state !== 'replaced')!;
    // Fällig am 01.01.2027, Brief am 10.02.2027: Der Plan nennt den angekündigten Einzugstag, nicht die Fälligkeit (E1).
    expect(charge.dueOn).toBe('2027-01-01');
    expect(row.plan).toEqual([{ dueOn: '2027-02-24', amountCents: 1200, remittance: `Beitrag 2027 Mitglied ${member.memberNumber}` }]);
  });

  it('by direct debit, a fee already paid gets no line „Einzug am …: 0,00 €“ and no direct debit sentence (R2/R14)', async () => {
    const { deps, ctx, types } = await setup();
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'finance.sepa.creditorId', 'DE98ZZZ09999999999'));
    const member = unwrap(await admitMember(deps, ctx, { contactId: await contact(deps), typeId: types.regular, admittedOn: '2027-01-01', letter: false }));
    unwrap(await setFeeAgreement(deps, ctx, { membershipId: member.id, validFrom: '2027-01-01', paymentMethod: 'directDebit', iban: 'DE44999999990532013000', debtorName: 'Erika Beispiel' }));
    const charge = deps.db.select().from(memberFeeCharges).where(eq(memberFeeCharges.membershipId, member.id)).all().find((c) => c.state === 'created')!;
    await payOpenItem(deps, charge.openItemId!, 1200, '2027-02-05');
    const input = inputOf(deps, unwrap(await issueMemberLetterInternal(deps, ctx, { kind: 'admission', membershipId: member.id })).documentId);
    expect(JSON.stringify(input.outro)).not.toContain('Einzug am');
    expect(JSON.stringify(input.outro)).not.toContain('Wir ziehen');
  });

  it('by direct debit, a fee already due names as collection day the earliest day the letter can announce, and the run collects it no earlier', async () => {
    const { deps, ctx, types } = await setup();
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'finance.sepa.creditorId', 'DE98ZZZ09999999999'));
    const member = unwrap(await admitMember(deps, ctx, { contactId: await contact(deps), typeId: types.regular, admittedOn: '2027-01-01', letter: false }));
    unwrap(await setFeeAgreement(deps, ctx, { membershipId: member.id, validFrom: '2027-01-01', paymentMethod: 'directDebit', iban: 'DE44999999990532013000', debtorName: 'Erika Beispiel' }));
    const issued = unwrap(await issueMemberLetterInternal(deps, ctx, { kind: 'admission', membershipId: member.id }));
    // Fällig am 01.01.2027, Brief am 10.02.2027, Vorabankündigung 14 Tage: Einzug frühestens Mittwoch, 24.02.2027.
    const input = inputOf(deps, issued.documentId);
    expect(input.outro).toContain('Einzug am 24.02.2027: 12,00\u00a0€');
    expect(JSON.stringify(input)).not.toContain('01.01.2027:');
    const mandateId = deps.db.select().from(financeSepaMandates).get()!.id;
    expect(deps.db.select().from(financeSepaPrenotifications).where(eq(financeSepaPrenotifications.documentId, issued.documentId)).get()!.plan).toEqual([{ dueOn: '2027-02-24', amountCents: 1200, remittance: `Beitrag 2027 Mitglied ${member.memberNumber}` }]);
    expect(prenotificationCovers(deps, mandateId, 1200, '2027-02-23', 14)).toBe(false);
    expect(prenotificationCovers(deps, mandateId, 1200, '2027-02-24', 14)).toBe(true);
    // Ein Einzug Wochen später ist nicht mehr gedeckt (E1 c).
    expect(prenotificationCovers(deps, mandateId, 1200, '2027-03-24', 14)).toBe(false);
  });

  it('no letter for a late entry without application, nor when asked not to', async () => {
    const { deps, ctx, types } = await setup();
    const before = deps.db.select().from(documents).all().length;
    const late = unwrap(await admitMember(deps, ctx, { contactId: await contact(deps), typeId: types.regular, admittedOn: '2026-01-01' }));
    expect(late.letter).toBeNull();
    const applied = unwrap(await recordApplication(deps, ctx, { contactId: await contact(deps, { lastName: 'Zweite' }), typeId: types.regular, appliedOn: '2027-01-20' }));
    expect(unwrap(await admitMember(deps, ctx, { membershipId: applied.id, admittedOn: '2027-02-01', letter: false })).letter).toBeNull();
    expect(deps.db.select().from(documents).all().length).toBe(before);
  });
});

describe('Austritt und Ablehnung', () => {
  it('a resignation issues the confirmation with the end date', async () => {
    const { deps, ctx, types } = await setup();
    const member = unwrap(await admitMember(deps, ctx, { contactId: await contact(deps), typeId: types.regular, admittedOn: '2026-01-01' }));
    const resigned = unwrap(await recordResignation(deps, ctx, { membershipId: member.id, noticeOn: '2027-02-01', endsOn: '2027-12-31' }));
    const documentId = (resigned.letter as { documentId: string }).documentId;
    expect(deps.db.select().from(documents).where(eq(documents.id, documentId)).get()!.typeKey).toBe('member-resignation');
    expect(JSON.stringify(inputOf(deps, documentId))).toContain('31.12.2027');
  });

  it('a rejection issues a letter without reason', async () => {
    const { deps, ctx, types } = await setup();
    const applied = unwrap(await recordApplication(deps, ctx, { contactId: await contact(deps), typeId: types.regular, appliedOn: '2027-01-20' }));
    const rejected = unwrap(await rejectApplication(deps, ctx, { membershipId: applied.id, rejectedOn: '2027-02-01' }));
    const documentId = (rejected.letter as { documentId: string }).documentId;
    expect(deps.db.select().from(documents).where(eq(documents.id, documentId)).get()!.typeKey).toBe('member-rejection');
    expect(linksOf(deps, documentId)).toEqual(expect.arrayContaining([['membership', 'about'], ['contact', 'recipient']]));
  });
});

describe('Mahnung', () => {
  it('table, deadline as its own sentence, transfer block with „Beitrag 2026 Mitglied 0006“, level text', async () => {
    const env = await setupFees({ now: NOW, validFrom: '2026-01-01', permissions: [...MEMBERS_PERMISSIONS, ...FINANCE_PERMISSIONS] });
    const { deps, ctx, types } = env;
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'organization.iban', ORG_IBAN));
    unwrap(await setNextMemberNumber(deps, ctx, { next: 6 }));
    const member = unwrap(await admitMember(deps, ctx, { contactId: await contact(deps), typeId: types.regular, admittedOn: '2026-01-01' }));
    expect(member.memberNumber).toBe('0006');
    const charge = deps.db.select().from(memberFeeCharges).where(and(eq(memberFeeCharges.membershipId, member.id), eq(memberFeeCharges.periodStart, '2026-01-01'))).get()!;
    await payOpenItem(deps, charge.openItemId!, 200, '2026-03-01');
    const issued = unwrap(await issueMemberLetterInternal(deps, ctx, { kind: 'reminder', membershipId: member.id, data: { levelName: 'Mahnung', levelText: 'Bitte melden Sie sich bei uns.', chargeIds: [charge.id], returnedOn: null } }));
    const doc = deps.db.select().from(documents).where(eq(documents.id, issued.documentId)).get()!;
    expect(doc).toMatchObject({ typeKey: 'member-reminder', subject: 'Mitgliedsbeitrag 2026 – Mahnung' });
    const input = inputOf(deps, issued.documentId);
    expect(input.table.rows).toEqual([['2026', '01.01.2026', '12,00\u00a0€', '2,00\u00a0€', '10,00\u00a0€']]);
    expect(input.table.foot).toEqual(['Offen', '', '', '', '10,00\u00a0€']);
    expect(readSetting(deps, 'members.paymentTermDays')).toBe(14);
    expect(input.deadline).toBe('Bitte überweisen Sie 10,00\u00a0€ bis zum 24.02.2027.');
    expect(input.transfer).toMatchObject({ amount: '10,00\u00a0€', reference: 'Beitrag 2026 Mitglied 0006' });
    expect(input.outro).toContain('Bitte melden Sie sich bei uns.');
    const body = bodyOf(deps, issued.documentId);
    expect(body).toContain('#strong[');
    expect(body).toContain('#transfer-block(');
  });

  it('after a return the letter says so before the table, with the day of the collection from the return; the payment request has no level (M22, M24)', async () => {
    const env = await setupFees({ now: NOW, validFrom: '2026-01-01', permissions: [...MEMBERS_PERMISSIONS, ...FINANCE_PERMISSIONS] });
    const { deps, ctx, types } = env;
    const member = unwrap(await admitMember(deps, ctx, { contactId: await contact(deps), typeId: types.regular, admittedOn: '2026-01-01' }));
    const charge = deps.db.select().from(memberFeeCharges).where(eq(memberFeeCharges.membershipId, member.id)).get()!;
    // Ohne festgeschriebene Rückgabe keine Zahlungsaufforderung „nach Rücklastschrift“.
    expect(fail(await issueMemberLetterInternal(deps, ctx, { kind: 'paymentRequest', membershipId: member.id, data: { chargeIds: [charge.id] } }))).toMatchObject({ type: 'conflict', code: 'paymentRequestNeedsReturn' });
    await returnedCollection(deps, charge.openItemId!, '2026-01-05', member.contactId);
    const issued = unwrap(await issueMemberLetterInternal(deps, ctx, { kind: 'paymentRequest', membershipId: member.id, data: { chargeIds: [charge.id] } }));
    const doc = deps.db.select().from(documents).where(eq(documents.id, issued.documentId)).get()!;
    expect(doc.typeKey).toBe('member-reminder');
    expect(doc.subject).toBe('Mitgliedsbeitrag 2026 – Zahlungsaufforderung');
    // Nach „Guten Tag,“ bzw. der Anrede klein weiter (M24).
    expect(inputOf(deps, issued.documentId).intro[1]).toBe('die Lastschrift vom 05.01.2026 wurde von Ihrer Bank zurückgegeben.');
  });
});

/** Ein eingereichter Einzug mit diesem Posten, zurückgegeben (Fall „Rückgabe zu klären“ angelegt, wie nach dem Festschreiben). */
async function returnedCollection(deps: MembersDeps, openItemId: string, collectionDate: string, contactId: string) {
  const now = `${collectionDate}T08:00:00.000Z`;
  const fctx: CallContext = { ...systemContext(), permissions: new Set(FINANCE_PERMISSIONS) };
  const account = deps.db.select().from(financeAccounts).get() ?? unwrap(await createAccount(deps, fctx, { name: 'Vereinskonto', kind: 'bank', iban: 'DE23999999990000202051', isMain: true }));
  const mandateId = deps.db.select().from(financeSepaMandates).get()?.id ?? unwrap(await prepareMandate(deps, fctx, { contactId, debtorName: 'Erika Beispiel', iban: 'DE44999999990532013000' })).id;
  const runId = newId();
  deps.db.insert(financeDirectDebitRuns).values({ id: runId, collectionDate, accountId: account.id, status: 'submitted', messageId: runId, submittedOn: collectionDate, createdByUserId: 'system', createdAt: now, updatedAt: now }).run();
  const itemId = newId();
  deps.db.insert(financeDirectDebitItems).values({ id: itemId, runId, mandateId, source: 'openItem', sourceId: openItemId, installmentOn: null, amountCents: 1200, endToEndId: `${runId}-1`, remittance: 'Beitrag', createdAt: now }).run();
  deps.db.insert(financeDirectDebitReturns).values({ id: newId(), itemId, rawTransactionId: 'RAW', entryId: 'ENTRY', returnCode: 'AM04', feeCents: 0, status: 'open', createdAt: now }).run();
}

describe('Briefe prüfen Zustand und Empfänger (Plan N1 Task 6)', () => {
  async function minor() {
    const env = await setup();
    const { deps, ctx, types } = env;
    const guardian = await contact(deps, { lastName: 'Vormund' });
    const kid = await contact(deps, { lastName: 'Klein' });
    deps.db.update(contacts).set({ firstName: 'Kim' }).where(eq(contacts.id, kid)).run();
    const applied = unwrap(await recordApplication(deps, ctx, { contactId: kid, typeId: types.regular, appliedOn: '2027-01-20', birthDate: '2015-05-01', guardianContactId: guardian }));
    const admitted = unwrap(await admitMember(deps, ctx, { membershipId: applied.id, admittedOn: '2027-02-01' }));
    return { ...env, guardian, kid, admitted };
  }

  it('(a) a letter to the guardian names the member: info line and text (M3)', async () => {
    const { deps, ctx, admitted } = await minor();
    const admission = inputOf(deps, (admitted.letter as { documentId: string }).documentId);
    expect(admission.info).toContainEqual({ label: 'Mitglied', value: 'Kim Klein' });
    expect(admission.intro[1]).toContain('Kim Klein als Mitglied');
    expect(admission.intro[1]).not.toContain('Sie als Mitglied');
    const notice = unwrap(await issueMemberLetterInternal(deps, ctx, { kind: 'feeNotice', membershipId: admitted.id, data: { year: 2027 } }));
    expect(inputOf(deps, notice.documentId).info).toContainEqual({ label: 'Mitglied', value: 'Kim Klein' });
  });

  it('(a2) the admission to the guardian heads its table „Die Mitgliedschaft“ (R14)', async () => {
    const { deps, admitted } = await minor();
    expect(inputOf(deps, (admitted.letter as { documentId: string }).documentId).table.head[0]).toBe('Die Mitgliedschaft');
  });

  it('(b2) a fee notice with only paid fees does not call them due and says nothing is open (R15, M21)', async () => {
    const { deps, ctx, types } = await setup();
    const member = unwrap(await admitMember(deps, ctx, { contactId: await contact(deps), typeId: types.regular, admittedOn: '2027-01-01', letter: false }));
    const charge = deps.db.select().from(memberFeeCharges).where(eq(memberFeeCharges.membershipId, member.id)).all().find((c) => c.state === 'created')!;
    await payOpenItem(deps, charge.openItemId!, 1200, '2027-01-20');
    const input = inputOf(deps, unwrap(await issueMemberLetterInternal(deps, ctx, { kind: 'feeNotice', membershipId: member.id, data: { year: 2027 } })).documentId);
    expect(input.intro[1]).not.toContain('fällig');
    expect(input.table.rows[0]).toEqual(['2027', 'bezahlt', '12,00\u00a0€']);
    expect(input.outro).toContain('Für 2027 ist nichts mehr offen.');
    expect(input.deadline).toBeNull();
  });

  it('(b) the fee notice marks paid fees, sums what is still open and puts the sentence with colon right before the transfer block (M21, release #2)', async () => {
    const { deps, ctx, types } = await setup();
    const member = unwrap(await admitMember(deps, ctx, { contactId: await contact(deps), typeId: types.supporting, admittedOn: '2027-01-01' }));
    const [january] = deps.db.select().from(memberFeeCharges).where(eq(memberFeeCharges.membershipId, member.id)).all().filter((c) => c.state === 'created').sort((a, b) => a.periodStart.localeCompare(b.periodStart));
    await payOpenItem(deps, january!.openItemId!, 1000, '2027-01-20');
    const issued = unwrap(await issueMemberLetterInternal(deps, ctx, { kind: 'feeNotice', membershipId: member.id, data: { year: 2027 } }));
    const input = inputOf(deps, issued.documentId);
    expect(input.table.rows[0]).toEqual(['2027-01', 'bezahlt', '10,00\u00a0€']);
    // Februar war am 01.02. fällig, der Brief ist vom 10.02.: Frist Briefdatum plus Zahlungsziel (wie im Aufnahmebrief).
    expect(input.table.rows[1]).toEqual(['2027-02', 'bis 24.02.2027', '10,00\u00a0€']);
    expect(input.table.rows[2]).toEqual(['2027-03', 'bis 01.03.2027', '10,00\u00a0€']);
    expect(input.table.foot).toEqual(['noch offen', '', '110,00\u00a0€']);
    expect(input.deadline).toMatch(/:$/);
    expect(input.transfer).toMatchObject({ reference: `Beitrag 2027-02 Mitglied ${member.memberNumber}` });
    expect(input.outro.join(' ')).not.toContain('Bitte überweisen');
    const body = bodyOf(deps, issued.documentId);
    expect(body.indexOf('Bitte überweisen')).toBeLessThan(body.indexOf('#transfer-block('));
  });

  it('(d) letters only in a fitting state: rejection only for an application, admission only once admitted, fee notice only for a year with membership (M23)', async () => {
    const { deps, ctx, types } = await setup();
    const member = unwrap(await admitMember(deps, ctx, { contactId: await contact(deps), typeId: types.regular, admittedOn: '2027-01-01', letter: false }));
    expect(fail(await issueMemberLetterInternal(deps, ctx, { kind: 'rejection', membershipId: member.id }))).toMatchObject({ type: 'conflict', code: 'membershipNotApplied' });
    expect(fail(await issueMemberLetterInternal(deps, ctx, { kind: 'feeNotice', membershipId: member.id, data: { year: 2026 } }))).toMatchObject({ type: 'conflict', code: 'membershipNotInYear', params: { year: 2026 } });
    const applied = unwrap(await recordApplication(deps, ctx, { contactId: await contact(deps, { lastName: 'Antrag' }), typeId: types.regular, appliedOn: '2027-01-20' }));
    expect(fail(await issueMemberLetterInternal(deps, ctx, { kind: 'admission', membershipId: applied.id }))).toMatchObject({ type: 'conflict', code: 'membershipNotActive' });
    expect(fail(await issueMemberLetterInternal(deps, ctx, { kind: 'feeNotice', membershipId: applied.id, data: { year: 2027 } }))).toMatchObject({ type: 'conflict', code: 'membershipNotInYear' });
  });

  it('(e) a fee notice without fees goes on in lower case after the greeting (M24)', async () => {
    const { deps, ctx, types } = await setup();
    const member = unwrap(await admitMember(deps, ctx, { contactId: await contact(deps), typeId: types.honorary, admittedOn: '2027-01-01', letter: false }));
    const issued = unwrap(await issueMemberLetterInternal(deps, ctx, { kind: 'feeNotice', membershipId: member.id, data: { year: 2027 } }));
    expect(inputOf(deps, issued.documentId).intro[1]).toBe('für dieses Jahr fällt kein Beitrag an.');
  });

  it('(f) an account holder other than the member gets the prenotification as own letter; the notice to the member says „vom Konto von …“ (M39)', async () => {
    const { deps, ctx, types } = await setup();
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'finance.sepa.creditorId', 'DE98ZZZ09999999999'));
    const member = unwrap(await admitMember(deps, ctx, { contactId: await contact(deps), typeId: types.regular, admittedOn: '2027-01-01', letter: false }));
    const holder = await contact(deps, { lastName: 'Kontoinhaber' });
    unwrap(await setFeeAgreement(deps, ctx, { membershipId: member.id, validFrom: '2027-01-01', paymentMethod: 'directDebit', iban: 'DE44999999990532013000', debtorName: 'Jürgen Kontoinhaber', payerContactId: holder }));
    const ctxAll: CallContext = { ...ctx, permissions: new Set([...ctx.permissions, 'dms.view', 'dms.create', 'dms.file']) };
    const issued = unwrap(await issueMemberLetterInternal(deps, ctxAll, { kind: 'feeNotice', membershipId: member.id, data: { year: 2027 } }));
    expect(inputOf(deps, issued.documentId).outro.join(' ')).toContain('vom Konto von Jürgen Kontoinhaber');
    const rows = deps.db.select().from(financeSepaPrenotifications).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.documentId).not.toBe(issued.documentId);
    expect(issued.prenotification).toMatchObject({ documentId: rows[0]!.documentId });
    const recipient = deps.db.select().from(documentLinks).where(and(eq(documentLinks.documentId, rows[0]!.documentId), eq(documentLinks.role, 'recipient'))).get()!;
    expect(recipient.entityId).toBe(holder);
  });
});

describe('Beitragsmitteilung', () => {
  it('lists the fees of the year with due date and amount', async () => {
    const { deps, ctx, types } = await setup();
    const member = unwrap(await admitMember(deps, ctx, { contactId: await contact(deps), typeId: types.supporting, admittedOn: '2027-01-01' }));
    const issued = unwrap(await issueMemberLetterInternal(deps, ctx, { kind: 'feeNotice', membershipId: member.id, data: { year: 2027 } }));
    expect(deps.db.select().from(documents).where(eq(documents.id, issued.documentId)).get()!.typeKey).toBe('member-fee-notice');
    const input = inputOf(deps, issued.documentId);
    expect(input.table.rows).toHaveLength(12);
    // Fällig am 01.01., Brief am 10.02.: Frist Briefdatum plus Zahlungsziel (release #2).
    expect(input.table.rows[0]).toEqual(['2027-01', 'bis 24.02.2027', '10,00\u00a0€']);
  });
});

describe('Empfänger ohne Anschrift (Review Focus 3)', () => {
  it('without address and without email: refused with addressMissing; with email only: issued', async () => {
    const { deps, ctx, types } = await setup();
    const none = unwrap(await admitMember(deps, ctx, { contactId: await contact(deps, { address: false }), typeId: types.regular, admittedOn: '2026-01-01' }));
    expect(fail(await issueMemberLetterInternal(deps, ctx, { kind: 'feeNotice', membershipId: none.id, data: { year: 2027 } }))).toMatchObject({ type: 'conflict', code: 'addressMissing' });
    const mailOnly = unwrap(await admitMember(deps, ctx, { contactId: await contact(deps, { address: false, email: 'erika@example.org', lastName: 'Post' }), typeId: types.regular, admittedOn: '2026-01-01' }));
    expect(unwrap(await issueMemberLetterInternal(deps, ctx, { kind: 'feeNotice', membershipId: mailOnly.id, data: { year: 2027 } })).documentId).toEqual(expect.any(String));
  });

  it('the admission itself is never blocked; the result names the refusal', async () => {
    const { deps, ctx, types } = await setup();
    const applied = unwrap(await recordApplication(deps, ctx, { contactId: await contact(deps, { address: false }), typeId: types.regular, appliedOn: '2027-01-20' }));
    const admitted = unwrap(await admitMember(deps, ctx, { membershipId: applied.id, admittedOn: '2027-02-01' }));
    expect(admitted.memberNumber).toBeTruthy();
    expect(admitted.letter).toEqual({ refused: 'addressMissing' });
  });

  it('a minor gets the letter at the guardian', async () => {
    const { deps, ctx, types } = await setup();
    const guardian = await contact(deps, { lastName: 'Vormund' });
    const applied = unwrap(await recordApplication(deps, ctx, { contactId: await contact(deps, { address: false }), typeId: types.regular, appliedOn: '2027-01-20', birthDate: '2015-05-01', guardianContactId: guardian }));
    const admitted = unwrap(await admitMember(deps, ctx, { membershipId: applied.id, admittedOn: '2027-02-01' }));
    const documentId = (admitted.letter as { documentId: string }).documentId;
    const recipient = deps.db.select().from(documentLinks).where(and(eq(documentLinks.documentId, documentId), eq(documentLinks.role, 'recipient'))).get()!;
    expect(recipient.entityId).toBe(guardian);
  });
});

describe('issueMemberLetter (Dienst)', () => {
  it('is human only and needs the right of its kind', async () => {
    const { deps, ctx, types } = await setup();
    const member = unwrap(await admitMember(deps, ctx, { contactId: await contact(deps), typeId: types.regular, admittedOn: '2026-01-01' }));
    expect(fail(await issueMemberLetter(deps, asMcp(ctx), { kind: 'feeNotice', membershipId: member.id, year: 2027 }))).toMatchObject({ type: 'conflict', code: 'humanOnly' });
    expect(fail(await issueMemberLetter(deps, { ...ctx, permissions: new Set(['members.read', 'members.manage']) }, { kind: 'feeNotice', membershipId: member.id, year: 2027 }))).toMatchObject({ type: 'forbidden' });
    expect(fail(await issueMemberLetter(deps, ctx, { kind: 'feeNotice', membershipId: member.id }))).toMatchObject({ type: 'validation' });
    expect(unwrap(await issueMemberLetter(deps, ctx, { kind: 'feeNotice', membershipId: member.id, year: 2027 })).documentId).toEqual(expect.any(String));
  });
});

describe('Bescheinigung über die Mitgliederzahl', () => {
  it('counts like countMembersAt, has no protection area and no names', async () => {
    const { deps, ctx, types } = await setup();
    unwrap(await admitMember(deps, ctx, { contactId: await contact(deps), typeId: types.regular, admittedOn: '2026-01-01' }));
    unwrap(await admitMember(deps, ctx, { contactId: await contact(deps, { lastName: 'Zwei' }), typeId: types.supporting, admittedOn: '2026-01-01' }));
    const counted = unwrap(await countMembersAt(deps, ctx, { date: '2027-01-31' }));
    const issued = unwrap(await issueMemberCountCertificate(deps, ctx, { date: '2027-01-31' }));
    const doc = deps.db.select().from(documents).where(eq(documents.id, issued.documentId)).get()!;
    expect(doc.typeKey).toBe('member-count-certificate');
    expect(deps.db.select().from(documentTypes).where(eq(documentTypes.key, 'member-count-certificate')).get()).toMatchObject({ protectionArea: null, retentionClass: 'permanent' });
    const input = inputOf(deps, issued.documentId);
    expect(input.total).toBe(counted.total);
    expect(input.byType.map((t: { count: number }) => t.count)).toEqual(counted.byType.map((t) => t.count));
    expect(JSON.stringify(input)).not.toContain('Beispiel');
    expect(auditOf(deps, 'members.countCertificate.issue').at(-1)!.params).toEqual({ countedOn: '2027-01-31', count: counted.total, documentNumber: doc.number });
  });

  it('needs members.manage and a human', async () => {
    const { deps, ctx } = await setup();
    expect(fail(await issueMemberCountCertificate(deps, { ...ctx, permissions: new Set(['members.read']) }, { date: '2027-01-31' }))).toMatchObject({ type: 'forbidden' });
    expect(fail(await issueMemberCountCertificate(deps, asMcp(ctx), { date: '2027-01-31' }))).toMatchObject({ type: 'conflict', code: 'humanOnly' });
    expect(fail(await issueMemberCountCertificate(deps, ctx, { date: 'gestern' }))).toMatchObject({ type: 'validation' });
  });
});

describe('Briefe mit echtem Typst', () => {
  it('Mahnung und Bescheinigung setzen sich auf dem Briefkopf', async () => {
    const { createDocumentEngine, pdfPageCount, qrRows } = await import('@kompass/documents');
    const { DEFAULT_THEME } = await import('@kompass/core/themes');
    const engine = createDocumentEngine();
    const ctx = { number: 'MMA-2027-001', issuedAt: NOW, issuedDay: '2027-02-10', organization: { 'organization.name': 'Musterverein e.V.' }, theme: DEFAULT_THEME, logo: null } as never;
    const reminder = memberLetterTemplates.find((t) => t.key === 'member-reminder')!;
    const input = {
      recipient: 'Frau\nErika Beispiel\nLindenweg 4\n12345 Beispielstadt',
      subject: 'Mitgliedsbeitrag 2026 – Mahnung',
      info: [{ label: 'Mitgliedsnummer', value: '0006' }],
      intro: ['Sehr geehrte Frau Beispiel,', 'Die Lastschrift vom 05.01.2026 wurde von Ihrer Bank zurückgegeben.', 'nach unseren Unterlagen ist der folgende Beitrag noch offen:'],
      table: { head: ['Beitrag', 'fällig am', 'Betrag', 'bezahlt', 'offen'], rows: [['2026', '01.01.2026', '12,00 €', '2,00 €', '10,00 €']], foot: ['Offen', '', '', '', '10,00 €'], align: ['left', 'left', 'right', 'right', 'right'] },
      deadline: 'Bitte überweisen Sie 10,00 € bis zum 24.02.2027.',
      transfer: { name: 'Musterverein e.V.', iban: ORG_IBAN, bic: null, amount: '10,00 €', reference: 'Beitrag 2026 Mitglied 0006', qr: qrRows('BCD\n002\n1\nSCT\n\nMusterverein e.V.\nDE23999999990000202051\nEUR10.00\n\n\nBeitrag 2026 Mitglied 0006\n'), labels: { title: 'Überweisung', recipient: 'Empfänger', iban: 'IBAN', bic: 'BIC', amount: 'Betrag', reference: 'Verwendungszweck', qr: 'GiroCode' } },
      outro: ['Bitte melden Sie sich bei uns.', 'Sollte sich Ihre Zahlung mit diesem Schreiben überschnitten haben, betrachten Sie es bitte als gegenstandslos.'],
      closing: ['Mit freundlichen Grüßen', 'Musterverein e.V.'],
    };
    for (const [template, data] of [[reminder, input], [memberLetterTemplates.find((t) => t.key === 'member-count-certificate')!, { organizationName: 'Musterverein e.V.', date: '2027-01-31', total: 2, byType: [{ name: 'Ordentlich', count: 1 }, { name: 'Fördernd', count: 1 }] }]] as const) {
      const built = template.build(data as never, ctx);
      const { bytes } = await engine.render({ baseId: 'a4-mit-briefkopf', bodyTypst: 'typst' in built.body ? built.body.typst : '', slots: built.slots, context: ctx });
      expect(pdfPageCount(bytes)).toBe(1);
    }
  });
});
