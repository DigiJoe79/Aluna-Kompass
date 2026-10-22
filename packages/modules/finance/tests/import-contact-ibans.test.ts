import { schema, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { contacts } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { contactForIbanInternal, contactsForIbanInternal, createContactFromTransaction, learnContactIbanInternal, linkContactIban, listContactIbans, unlinkContactIban } from '../src/import/contact-ibans';
import { FINANCE_PERMISSIONS } from '../src/manifest';
import { financeContactBankAccounts, financeSepaMandates } from '../src/schema';
import { insertRaw, insertRun, ledgerFixture } from './helpers';

const IBAN = 'DE66999999991234567890';
const IBAN_SPACED = 'de66 9999 9999 1234 5678 90';

const ibanLog = (f: Awaited<ReturnType<typeof ledgerFixture>>) => f.deps.db.select().from(schema.auditLog).all().filter((e) => e.entityType === 'financeContactBankAccount');

describe('linkContactIban', () => {
  it('links a normalized iban to an existing contact and records only where it was learned', async () => {
    const f = await ledgerFixture();
    const link = unwrap(await linkContactIban(f.deps, f.ctx, { contactId: f.donor.id, iban: IBAN_SPACED }));
    expect(link).toMatchObject({ contactId: f.donor.id, iban: IBAN });
    const log = ibanLog(f);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: 'finance.contactIban.link', entityId: link.id });
    expect(JSON.parse(log[0]!.after as string)).toEqual({ learnedFrom: 'manual' });
  });

  it('is idempotent for the same contact and iban', async () => {
    const f = await ledgerFixture();
    const first = unwrap(await linkContactIban(f.deps, f.ctx, { contactId: f.donor.id, iban: IBAN }));
    const second = unwrap(await linkContactIban(f.deps, f.ctx, { contactId: f.donor.id, iban: IBAN_SPACED }));
    expect(second.id).toBe(first.id);
    expect(f.deps.db.select().from(financeContactBankAccounts).all()).toHaveLength(1);
    expect(ibanLog(f)).toHaveLength(1);
  });

  it('refuses an iban that already belongs to another contact, naming the contact', async () => {
    const f = await ledgerFixture();
    unwrap(await linkContactIban(f.deps, f.ctx, { contactId: f.donor.id, iban: IBAN }));
    const refused = await linkContactIban(f.deps, f.ctx, { contactId: f.wrongDonor.id, iban: IBAN });
    expect(refused).toMatchObject({ ok: false, error: { type: 'conflict', code: 'contactIbanTaken' } });
    expect(JSON.stringify(refused)).toContain('Musterspenderin');
  });

  it('still refuses when the iban is a joint account of two other contacts', async () => {
    const f = await ledgerFixture();
    f.deps.db.transaction((tx) => learnContactIbanInternal(tx, f.deps, f.ctx, { contactId: f.donor.id, iban: IBAN, learnedFrom: 'booking' }));
    f.deps.db.transaction((tx) => learnContactIbanInternal(tx, f.deps, f.ctx, { contactId: f.rightDonor.id, iban: IBAN, learnedFrom: 'booking' }));
    expect(await linkContactIban(f.deps, f.ctx, { contactId: f.wrongDonor.id, iban: IBAN })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'contactIbanTaken' } });
    // Wer die IBAN schon trägt, verknüpft sie noch einmal ohne Ablehnung.
    expect(await linkContactIban(f.deps, f.ctx, { contactId: f.donor.id, iban: IBAN })).toMatchObject({ ok: true });
  });

  it('with mode shared a second person gets the iban as joint account — the same rule as learning (M18)', async () => {
    const f = await ledgerFixture();
    unwrap(await linkContactIban(f.deps, f.ctx, { contactId: f.donor.id, iban: IBAN }));
    const shared = unwrap(await linkContactIban(f.deps, f.ctx, { contactId: f.wrongDonor.id, iban: IBAN, mode: 'shared' }));
    expect(f.deps.db.select().from(financeContactBankAccounts).all().map((r) => r.contactId).sort()).toEqual([f.donor.id, f.wrongDonor.id].sort());
    // U10 (Plan N3): Das Ergebnis nennt die Mitinhaber wie die Liste.
    expect(shared.coHolders).toEqual([{ contactId: f.donor.id, name: expect.stringContaining('Musterspenderin') }]);
    expect(unwrap(await linkContactIban(f.deps, f.ctx, { contactId: f.wrongDonor.id, iban: IBAN })).coHolders).toEqual(shared.coHolders);
  });

  it('without mode the refusal names every holder of a joint account (U4)', async () => {
    const f = await ledgerFixture();
    unwrap(await linkContactIban(f.deps, f.ctx, { contactId: f.donor.id, iban: IBAN }));
    unwrap(await linkContactIban(f.deps, f.ctx, { contactId: f.rightDonor.id, iban: IBAN, mode: 'shared' }));
    const refused = await linkContactIban(f.deps, f.ctx, { contactId: f.wrongDonor.id, iban: IBAN });
    expect(refused).toMatchObject({ ok: false, error: { type: 'conflict', code: 'contactIbanTaken' } });
    expect(JSON.stringify(refused)).toContain('Musterspenderin');
    expect(JSON.stringify(refused)).toContain('Richtigspenderin');
  });

  it('with mode move the iban leaves the former holders and goes only to this contact, recorded (U4)', async () => {
    const f = await ledgerFixture();
    unwrap(await linkContactIban(f.deps, f.ctx, { contactId: f.donor.id, iban: IBAN }));
    unwrap(await linkContactIban(f.deps, f.ctx, { contactId: f.wrongDonor.id, iban: IBAN, mode: 'move' }));
    expect(f.deps.db.select().from(financeContactBankAccounts).all().map((r) => r.contactId)).toEqual([f.wrongDonor.id]);
    expect(ibanLog(f).map((e) => e.action)).toEqual(['finance.contactIban.link', 'finance.contactIban.delete', 'finance.contactIban.link']);
  });

  it('move and unlink are refused while a valid mandate of a holder runs over the iban (U4)', async () => {
    const f = await ledgerFixture();
    const link = unwrap(await linkContactIban(f.deps, f.ctx, { contactId: f.donor.id, iban: IBAN }));
    f.deps.db.insert(financeSepaMandates).values({ id: 'MANDATE-1', contactId: f.donor.id, reference: 'M-0001', debtorName: 'Musterspenderin', iban: IBAN, preparedOn: '2026-01-02', signedOn: '2026-01-05', createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-05T00:00:00.000Z' }).run();
    const moved = await linkContactIban(f.deps, f.ctx, { contactId: f.wrongDonor.id, iban: IBAN, mode: 'move' });
    expect(moved).toMatchObject({ ok: false, error: { type: 'conflict', code: 'ibanHasMandate', params: { mandateId: 'MANDATE-1' } } });
    expect(await unlinkContactIban(f.deps, f.ctx, { id: link.id })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'ibanHasMandate' } });
    expect(f.deps.db.select().from(financeContactBankAccounts).all().map((r) => r.contactId)).toEqual([f.donor.id]);
    // Ein Gemeinschaftskonto lässt das Mandat unberührt — es geht.
    expect(await linkContactIban(f.deps, f.ctx, { contactId: f.wrongDonor.id, iban: IBAN, mode: 'shared' })).toMatchObject({ ok: true });
    // Ein beendetes Mandat sperrt nicht mehr.
    f.deps.db.update(financeSepaMandates).set({ endedOn: '2026-02-01' }).run();
    expect(await unlinkContactIban(f.deps, f.ctx, { id: link.id })).toMatchObject({ ok: true });
  });

  it('needs finance.entriesWrite', async () => {
    const f = await ledgerFixture();
    expect(await linkContactIban(f.deps, ctxWith(['finance.read']), { contactId: f.donor.id, iban: IBAN })).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'finance.entriesWrite' } });
  });

  it('refuses an invalid iban as validation and an unknown contact as notFound', async () => {
    const f = await ledgerFixture();
    expect(await linkContactIban(f.deps, f.ctx, { contactId: f.donor.id, iban: 'DE00123' })).toMatchObject({ ok: false, error: { type: 'validation', issues: [{ path: 'iban', message: 'invalidIban' }] } });
    expect(await linkContactIban(f.deps, f.ctx, { contactId: 'nope', iban: IBAN })).toMatchObject({ ok: false, error: { type: 'notFound' } });
  });
});

describe('unlinkContactIban', () => {
  it('deletes the link and records the deletion', async () => {
    const f = await ledgerFixture();
    const link = unwrap(await linkContactIban(f.deps, f.ctx, { contactId: f.donor.id, iban: IBAN }));
    expect(unwrap(await unlinkContactIban(f.deps, f.ctx, { id: link.id }))).toEqual({ id: link.id });
    expect(f.deps.db.select().from(financeContactBankAccounts).all()).toEqual([]);
    expect(ibanLog(f).map((e) => e.action)).toEqual(['finance.contactIban.link', 'finance.contactIban.delete']);
  });

  it('needs finance.entriesWrite, a valid input and an existing link', async () => {
    const f = await ledgerFixture();
    const link = unwrap(await linkContactIban(f.deps, f.ctx, { contactId: f.donor.id, iban: IBAN }));
    expect(await unlinkContactIban(f.deps, ctxWith(['finance.read']), { id: link.id })).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'finance.entriesWrite' } });
    expect(await unlinkContactIban(f.deps, f.ctx, {})).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(await unlinkContactIban(f.deps, f.ctx, { id: 'nope' })).toMatchObject({ ok: false, error: { type: 'notFound' } });
  });
});

describe('listContactIbans', () => {
  it('names the origin — from a booking with its date, by hand with person and date, from a mandate — and the co-holders (U4)', async () => {
    const f = await ledgerFixture();
    f.deps.db.transaction((tx) => learnContactIbanInternal(tx, f.deps, f.ctx, { contactId: f.donor.id, iban: IBAN, learnedFrom: 'booking', learnedOn: '2026-03-12' }));
    unwrap(await linkContactIban(f.deps, f.ctx, { contactId: f.donor.id, iban: 'DE23999999990000202051' }));
    f.deps.db.transaction((tx) => learnContactIbanInternal(tx, f.deps, f.ctx, { contactId: f.donor.id, iban: 'DE93999999990000202052', learnedFrom: 'mandate' }));
    unwrap(await linkContactIban(f.deps, f.ctx, { contactId: f.rightDonor.id, iban: IBAN, mode: 'shared' }));
    const { items } = unwrap(await listContactIbans(f.deps, ctxWith(['finance.read']), { contactId: f.donor.id }));
    expect(items.map((i) => [i.iban, i.source, i.learnedFromEntryDate])).toEqual([
      [IBAN, 'learned', '2026-03-12'],
      ['DE23999999990000202051', 'manual', null],
      ['DE93999999990000202052', 'mandate', null],
    ]);
    expect(items[1]).toMatchObject({ createdByUserId: f.userId, createdAt: expect.any(String) });
    expect(items[0]!.coHolders).toEqual([{ contactId: f.rightDonor.id, name: 'Richtigspenderin' }]);
    expect(items[1]!.coHolders).toEqual([]);
  });

  it('a link from before the origin was recorded has no source — and no error (U4)', async () => {
    const f = await ledgerFixture();
    f.deps.db.insert(financeContactBankAccounts).values({ id: 'CBA-OLD', contactId: f.donor.id, iban: IBAN, createdAt: '2026-01-01T00:00:00.000Z', createdByUserId: f.userId }).run();
    const { items } = unwrap(await listContactIbans(f.deps, f.ctx, { contactId: f.donor.id }));
    expect(items).toEqual([expect.objectContaining({ id: 'CBA-OLD', source: null, learnedFromEntryDate: null })]);
  });

  it('lists the ibans of one contact under finance.read', async () => {
    const f = await ledgerFixture();
    unwrap(await linkContactIban(f.deps, f.ctx, { contactId: f.donor.id, iban: IBAN }));
    unwrap(await linkContactIban(f.deps, f.ctx, { contactId: f.rightDonor.id, iban: 'DE23999999990000202051' }));
    const { items } = unwrap(await listContactIbans(f.deps, ctxWith(['finance.read']), { contactId: f.donor.id }));
    expect(items.map((i) => i.iban)).toEqual([IBAN]);
    expect(await listContactIbans(f.deps, ctxWith(['finance.overview']), { contactId: f.donor.id })).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'finance.read' } });
    expect(await listContactIbans(f.deps, f.ctx, {})).toMatchObject({ ok: false, error: { type: 'validation' } });
  });
});

describe('contactForIbanInternal and learnContactIbanInternal', () => {
  it('finds the one contact for an iban in any spelling; nothing for an unknown one', async () => {
    const f = await ledgerFixture();
    expect(contactForIbanInternal(f.deps.db, IBAN)).toBeNull();
    f.deps.db.transaction((tx) => learnContactIbanInternal(tx, f.deps, f.ctx, { contactId: f.donor.id, iban: IBAN, learnedFrom: 'booking' }));
    expect(contactForIbanInternal(f.deps.db, IBAN_SPACED)).toEqual({ contactId: f.donor.id });
    expect(contactForIbanInternal(f.deps.db, 'DE23999999990000202051')).toBeNull();
  });

  it('names no contact when two active contacts share the iban — a joint account (Befund 3, 0.2.12)', async () => {
    const f = await ledgerFixture();
    f.deps.db.transaction((tx) => learnContactIbanInternal(tx, f.deps, f.ctx, { contactId: f.donor.id, iban: IBAN, learnedFrom: 'booking' }));
    f.deps.clock.advance(1000);
    f.deps.db.transaction((tx) => learnContactIbanInternal(tx, f.deps, f.ctx, { contactId: f.rightDonor.id, iban: IBAN_SPACED, learnedFrom: 'booking' }));
    expect(contactForIbanInternal(f.deps.db, IBAN)).toBeNull();
    // Kompass kennt die IBAN trotzdem — jüngste Zuordnung zuerst.
    expect(contactsForIbanInternal(f.deps.db, IBAN_SPACED)).toEqual([f.rightDonor.id, f.donor.id]);
    // Ist einer der beiden archiviert, bleibt genau ein aktiver Kontakt.
    f.deps.db.update(contacts).set({ status: 'archived' }).where(eq(contacts.id, f.rightDonor.id)).run();
    expect(contactForIbanInternal(f.deps.db, IBAN)).toEqual({ contactId: f.donor.id });
    expect(contactsForIbanInternal(f.deps.db, IBAN)).toEqual([f.rightDonor.id, f.donor.id]);
  });

  it('names no contact when the only holder is archived, but still knows the iban', async () => {
    const f = await ledgerFixture();
    f.deps.db.transaction((tx) => learnContactIbanInternal(tx, f.deps, f.ctx, { contactId: f.donor.id, iban: IBAN, learnedFrom: 'booking' }));
    f.deps.db.update(contacts).set({ status: 'archived' }).where(eq(contacts.id, f.donor.id)).run();
    expect(contactForIbanInternal(f.deps.db, IBAN)).toBeNull();
    expect(contactsForIbanInternal(f.deps.db, IBAN)).toEqual([f.donor.id]);
  });

  it('learns nothing twice, and nothing from an invalid iban', async () => {
    const f = await ledgerFixture();
    f.deps.db.transaction((tx) => learnContactIbanInternal(tx, f.deps, f.ctx, { contactId: f.donor.id, iban: IBAN, learnedFrom: 'booking' }));
    f.deps.db.transaction((tx) => learnContactIbanInternal(tx, f.deps, f.ctx, { contactId: f.donor.id, iban: IBAN_SPACED, learnedFrom: 'booking' }));
    f.deps.db.transaction((tx) => learnContactIbanInternal(tx, f.deps, f.ctx, { contactId: f.donor.id, iban: 'XX00', learnedFrom: 'booking' }));
    expect(f.deps.db.select().from(financeContactBankAccounts).all()).toHaveLength(1);
    expect(ibanLog(f).map((e) => JSON.parse(e.after as string))).toEqual([{ learnedFrom: 'booking' }]);
  });

  it('ignores a link whose contact no longer exists', async () => {
    const f = await ledgerFixture();
    f.deps.db.insert(financeContactBankAccounts).values({ id: 'CBA-GONE', contactId: 'CONTACT-GONE', iban: IBAN, createdAt: '2026-01-01T00:00:00.000Z', createdByUserId: f.userId }).run();
    expect(contactForIbanInternal(f.deps.db, IBAN)).toBeNull();
    expect(contactsForIbanInternal(f.deps.db, IBAN)).toEqual([]);
  });
});

describe('createContactFromTransaction', () => {
  const manage = (f: Awaited<ReturnType<typeof ledgerFixture>>) => ctxWith([...FINANCE_PERMISSIONS, 'contacts.manage'], f.userId);

  it('creates a person from the counterparty, links the iban and records it as learned from creating the contact', async () => {
    const f = await ledgerFixture();
    const rawId = insertRaw(f, insertRun(f, f.bank.id), { accountId: f.bank.id, amountCents: 2500, name: 'Erika Beispiel', iban: IBAN_SPACED });
    const created = unwrap(await createContactFromTransaction(f.deps, manage(f), { rawTransactionId: rawId, kind: 'person', firstName: 'Erika', lastName: 'Beispiel' }));
    expect(created.contact).toMatchObject({ kind: 'person', firstName: 'Erika', lastName: 'Beispiel' });
    expect(contactForIbanInternal(f.deps.db, IBAN)).toEqual({ contactId: created.contact.id });
    expect(created.bankAccountId).not.toBeNull();
    expect(ibanLog(f).map((e) => JSON.parse(e.after as string))).toEqual([{ learnedFrom: 'contactCreate' }]);
    // Die Rolle „Spender“ setzt erst der erste Vorgang.
    expect(created.contact.roles).toEqual([]);
  });

  it('derives the name parts from the counterparty when not given', async () => {
    const f = await ledgerFixture();
    const run = insertRun(f, f.bank.id);
    const person = insertRaw(f, run, { accountId: f.bank.id, amountCents: 2500, name: 'Erika Maria Beispiel' });
    const comma = insertRaw(f, run, { accountId: f.bank.id, amountCents: 2600, name: 'Beispiel, Hans', iban: 'DE23999999990000202051' });
    const org = insertRaw(f, run, { accountId: f.bank.id, amountCents: 2700, name: 'Tierfreunde Musterstadt e.V.', iban: null });
    expect(unwrap(await createContactFromTransaction(f.deps, manage(f), { rawTransactionId: person, kind: 'person' })).contact).toMatchObject({ firstName: 'Erika Maria', lastName: 'Beispiel' });
    expect(unwrap(await createContactFromTransaction(f.deps, manage(f), { rawTransactionId: comma, kind: 'person' })).contact).toMatchObject({ firstName: 'Hans', lastName: 'Beispiel' });
    const organization = unwrap(await createContactFromTransaction(f.deps, manage(f), { rawTransactionId: org, kind: 'organization' }));
    expect(organization.contact).toMatchObject({ kind: 'organization', name: 'Tierfreunde Musterstadt e.V.' });
    // Ohne IBAN am Umsatz gibt es nichts zu lernen.
    expect(organization.bankAccountId).toBeNull();
  });

  it('refuses without contacts.manage when creating a contact', async () => {
    const f = await ledgerFixture();
    const rawId = insertRaw(f, insertRun(f, f.bank.id), { accountId: f.bank.id, amountCents: 2500 });
    expect(await createContactFromTransaction(f.deps, f.ctx, { rawTransactionId: rawId, kind: 'person' })).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'contacts.manage' } });
    expect(await createContactFromTransaction(f.deps, ctxWith(['contacts.manage', 'finance.read'], f.userId), { rawTransactionId: rawId, kind: 'person' })).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'finance.entriesWrite' } });
    expect(f.deps.db.select().from(contacts).where(eq(contacts.lastName, 'Beispiel')).all()).toEqual([]);
  });

  it('refuses an invalid input, an unknown transaction, and a counterparty without a name to derive from', async () => {
    const f = await ledgerFixture();
    const nameless = insertRaw(f, insertRun(f, f.bank.id), { accountId: f.bank.id, amountCents: 2500, name: null });
    expect(await createContactFromTransaction(f.deps, manage(f), { rawTransactionId: nameless, kind: 'robot' })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(await createContactFromTransaction(f.deps, manage(f), { rawTransactionId: 'nope', kind: 'person' })).toMatchObject({ ok: false, error: { type: 'notFound' } });
    expect(await createContactFromTransaction(f.deps, manage(f), { rawTransactionId: nameless, kind: 'person' })).toMatchObject({ ok: false, error: { type: 'validation' } });
  });

  it('audits create, link and unlink', async () => {
    const f = await ledgerFixture();
    const rawId = insertRaw(f, insertRun(f, f.bank.id), { accountId: f.bank.id, amountCents: 2500 });
    unwrap(await createContactFromTransaction(f.deps, manage(f), { rawTransactionId: rawId, kind: 'person' }));
    const link = unwrap(await linkContactIban(f.deps, f.ctx, { contactId: f.donor.id, iban: 'DE23999999990000202051' }));
    unwrap(await unlinkContactIban(f.deps, f.ctx, { id: link.id }));
    const log = ibanLog(f);
    expect(log).toHaveLength(3);
  });
});
