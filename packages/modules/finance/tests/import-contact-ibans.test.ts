import { schema, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { contacts } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { contactForIbanInternal, createContactFromTransaction, learnContactIbanInternal, linkContactIban, listContactIbans, unlinkContactIban } from '../src/import/contact-ibans';
import { FINANCE_PERMISSIONS } from '../src/manifest';
import { financeContactBankAccounts } from '../src/schema';
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
  it('finds the most recent contact for an iban in any spelling; nothing for an unknown one', async () => {
    const f = await ledgerFixture();
    expect(contactForIbanInternal(f.deps.db, IBAN)).toBeNull();
    f.deps.db.transaction((tx) => learnContactIbanInternal(tx, f.deps, f.ctx, { contactId: f.donor.id, iban: IBAN, learnedFrom: 'booking' }));
    f.deps.clock.advance(1000);
    f.deps.db.transaction((tx) => learnContactIbanInternal(tx, f.deps, f.ctx, { contactId: f.rightDonor.id, iban: IBAN_SPACED, learnedFrom: 'booking' }));
    expect(contactForIbanInternal(f.deps.db, IBAN_SPACED)).toEqual({ contactId: f.rightDonor.id });
    expect(contactForIbanInternal(f.deps.db, 'DE23999999990000202051')).toBeNull();
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

  it('never writes iban or contact id to the audit log', async () => {
    const f = await ledgerFixture();
    const rawId = insertRaw(f, insertRun(f, f.bank.id), { accountId: f.bank.id, amountCents: 2500 });
    const created = unwrap(await createContactFromTransaction(f.deps, manage(f), { rawTransactionId: rawId, kind: 'person' }));
    const link = unwrap(await linkContactIban(f.deps, f.ctx, { contactId: f.donor.id, iban: 'DE23999999990000202051' }));
    unwrap(await unlinkContactIban(f.deps, f.ctx, { id: link.id }));
    const log = ibanLog(f);
    expect(log).toHaveLength(3);
    const text = JSON.stringify(log);
    expect(text).not.toMatch(/DE66|DE23|999999/);
    expect(text).not.toContain(created.contact.id);
    expect(text).not.toContain(f.donor.id);
  });
});
