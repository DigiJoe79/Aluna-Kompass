import { unwrap, writeSettingInternal } from '@kompass/core';
import { ctxWith, systemContext } from '@kompass/core/testing';
import { createContact, updateContact } from '@kompass/module-contacts';
import { documentTypes } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { checkConfirmable, checkConfirmableInternal, CONFIRMATION_CHECK_KEYS, type ConfirmationCheck, type ConfirmationCheckKey } from '../src/donations/check';
import { createCategory } from '../src/ledger/categories';
import { saveDraft } from '../src/ledger/entries';
import { reverseEntry } from '../src/ledger/reverse';
import { donationFixture, err } from './donation-fixture';

const check = (r: { checks: ConfirmationCheck[] }, key: ConfirmationCheckKey): ConfirmationCheck => r.checks.find((c) => c.key === key)!;

describe('checkConfirmable', () => {
  it('checklist reports every one of the nine checks with a remedy and never throws', async () => {
    const f = await donationFixture({ notice: false });
    // Alles, was schiefgehen kann: Kontakt ohne Anschrift, kein Bescheid, kein Beleg.
    const { line } = await f.donate({ contactId: f.donor.id, documented: false });
    const res = unwrap(await checkConfirmable(f.deps, f.ctx, { lineIds: [line.id] }));

    expect(res.checks.map((c) => c.key)).toEqual([...CONFIRMATION_CHECK_KEYS]);
    expect(res.ok).toBe(false);
    const blocked = res.checks.filter((c) => c.blocked).map((c) => c.key);
    expect(blocked).toEqual(['contactComplete', 'noticeValid', 'documented']);
    for (const key of blocked) {
      expect(check(res, key).done, key).toBe(false);
      expect(check(res, key).remedy, key).toMatchObject({ labelKey: expect.any(String) });
    }
    expect(check(res, 'contactComplete').remedy!.href).toBe(`/contacts/${f.donor.id}`);
    expect(check(res, 'noticeValid').remedy!.href).toBe('/finance/donations/notices');
    expect(check(res, 'documented').remedy!.href).toBe(`/finance/entries/${line.entryId}`);
    for (const key of ['final', 'certifiable', 'notConfirmed', 'amountPositive', 'typeActive'] as const) expect(check(res, key), key).toMatchObject({ done: true, blocked: false, remedy: null });
    // Nicht zutreffend: Sachspende und Aufwandsspende bei einer Geldspende.
    expect(check(res, 'inKindDetails')).toMatchObject({ applies: false, done: true, blocked: false });
    expect(check(res, 'expenseWaiverEnabled')).toMatchObject({ applies: false, done: true, blocked: false });
    // Ein unvollständiges maschinelles Verfahren sperrt nie — dann eben mit Unterschriftsfeld.
    expect(check(res, 'signerValid')).toMatchObject({ done: false, blocked: false, warning: 'signatureField' });
    expect(res.notice).toBeNull();
  });

  it('passes a complete money donation and names notice, net amount and the state of the machine procedure', async () => {
    const f = await donationFixture({ machine: true });
    const { entry, line } = await f.donate({ cents: 5000 });
    const res = unwrap(await checkConfirmable(f.deps, f.ctx, { lineIds: [line.id] }));
    expect(res).toMatchObject({ ok: true, kind: 'money', contactId: f.erika.id, warnings: [], expenseWaiver: false, notice: { id: f.notice!.id, kind: 'exemptionNotice', noticeDate: '2025-05-02', validUntil: '2030-05-02' } });
    expect(res.lines).toEqual([{ lineId: line.id, entryId: entry.id, entryNumber: entry.number, entryDate: '2026-03-05', amountCents: 5000, netCents: 5000, incomeKind: 'donation' }]);
    expect(res.machine.complete).toBe(true);
    expect(check(res, 'signerValid')).toMatchObject({ done: true, blocked: false, warning: null });
    expect(res.checks.every((c) => !c.blocked)).toBe(true);
  });

  it('subtracts returns from the line and blocks once nothing is left', async () => {
    const f = await donationFixture();
    const { line } = await f.donate({ cents: 5000 });
    await f.giveBack(line.id, 2000);
    expect(unwrap(await checkConfirmable(f.deps, f.ctx, { lineIds: [line.id] })).lines[0]!.netCents).toBe(3000);
    await f.giveBack(line.id, 3000);
    const res = unwrap(await checkConfirmable(f.deps, f.ctx, { lineIds: [line.id] }));
    expect(check(res, 'amountPositive')).toMatchObject({ done: false, blocked: true, detail: { netCents: 0 } });
    expect(res.ok).toBe(false);
  });

  it('a reversed return does not count', async () => {
    const f = await donationFixture();
    const { line } = await f.donate({ cents: 5000 });
    const back = await f.giveBack(line.id, 2000);
    unwrap(await reverseEntry(f.deps, f.ctx, { id: back.entry.id }));
    expect(unwrap(await checkConfirmable(f.deps, f.ctx, { lineIds: [line.id] })).lines[0]!.netCents).toBe(5000);
  });

  it('blocks a draft and a reversed entry under "final"', async () => {
    const f = await donationFixture();
    const draft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-05', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 700 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 700, contactId: f.erika.id }] }));
    const onDraft = unwrap(await checkConfirmable(f.deps, f.ctx, { lineIds: [draft.allocationLines[0]!.id] }));
    expect(check(onDraft, 'final')).toMatchObject({ blocked: true, detail: { state: 'draft' } });

    const { entry, line } = await f.donate();
    unwrap(await reverseEntry(f.deps, f.ctx, { id: entry.id }));
    const onReversed = unwrap(await checkConfirmable(f.deps, f.ctx, { lineIds: [line.id] }));
    expect(check(onReversed, 'final')).toMatchObject({ blocked: true, detail: { state: 'reversed' } });
  });

  it('blocks income that is not certifiable, and membership fees while they are switched off', async () => {
    const f = await donationFixture();
    const sales = unwrap(await createCategory(f.deps, f.ctx, { key: 'sales-test', name: 'Flohmarkt', direction: 'income', sphere: 'purposeOperation', incomeKind: 'sales' }));
    const { line } = await f.donate({ categoryKey: sales.key });
    expect(check(unwrap(await checkConfirmable(f.deps, f.ctx, { lineIds: [line.id] })), 'certifiable')).toMatchObject({ blocked: true, detail: { category: 'Flohmarkt' } });

    const fee = await f.donate({ categoryKey: 'membership-fees', cents: 3600 });
    expect(check(unwrap(await checkConfirmable(f.deps, f.ctx, { lineIds: [fee.line.id] })), 'certifiable').blocked).toBe(false);
    f.deps.db.transaction((tx) => writeSettingInternal(tx, f.deps, systemContext(), 'finance.membershipFeesCertifiable', false, 'test'));
    expect(check(unwrap(await checkConfirmable(f.deps, f.ctx, { lineIds: [fee.line.id] })), 'certifiable')).toMatchObject({ blocked: true, detail: { category: 'Mitglieds- und Förderbeiträge' } });
  });

  it('a contact is complete with last name, street, postal code and city; an organisation and a foreign country only warn', async () => {
    const f = await donationFixture();
    const partial = unwrap(await createContact(f.deps, f.manage, { kind: 'person', lastName: 'Teilweise', street: 'Weg 2', city: 'Beispielstadt' }));
    const { line } = await f.donate({ contactId: partial.id });
    expect(check(unwrap(await checkConfirmable(f.deps, f.ctx, { lineIds: [line.id] })), 'contactComplete')).toMatchObject({ blocked: true, detail: { missing: 'postalCode' } });
    unwrap(await updateContact(f.deps, f.manage, { id: partial.id, postalCode: '54321', country: 'AT' }));
    const abroad = unwrap(await checkConfirmable(f.deps, f.ctx, { lineIds: [line.id] }));
    expect(check(abroad, 'contactComplete')).toMatchObject({ done: true, blocked: false, warning: 'foreignCountry' });
    expect(abroad.warnings).toEqual(['foreignCountry']);

    const org = unwrap(await createContact(f.deps, f.manage, { kind: 'organization', name: 'Beispiel GmbH', street: 'Industrieweg 3', postalCode: '12345', city: 'Musterstadt' }));
    const byOrg = await f.donate({ contactId: org.id });
    const res = unwrap(await checkConfirmable(f.deps, f.ctx, { lineIds: [byOrg.line.id] }));
    expect(res.ok).toBe(true);
    expect(res.warnings).toEqual(['organization']);
  });

  it('checks the notice on the day of issue and warns about a donation before the oldest notice', async () => {
    const f = await donationFixture();
    const early = await f.donate({ date: '2025-03-01' });
    const res = unwrap(await checkConfirmable(f.deps, f.ctx, { lineIds: [early.line.id] }));
    expect(res.ok).toBe(true);
    expect(res.warnings).toEqual(['beforeOldestNotice']);
    expect(check(res, 'noticeValid')).toMatchObject({ done: true, warning: 'beforeOldestNotice' });

    const { line } = await f.donate();
    const before = unwrap(await checkConfirmable(f.deps, f.ctx, { lineIds: [line.id], issuedOn: '2025-04-01' }));
    expect(check(before, 'noticeValid')).toMatchObject({ blocked: true, detail: { date: '2025-04-01' } });
  });

  it('blocks expense waivers while they are switched off, and an inactive document type', async () => {
    const f = await donationFixture();
    const { line } = await f.waive();
    const on = unwrap(await checkConfirmable(f.deps, f.ctx, { lineIds: [line.id] }));
    expect(on).toMatchObject({ ok: true, kind: 'money', expenseWaiver: true });
    expect(check(on, 'expenseWaiverEnabled')).toMatchObject({ applies: true, done: true });
    f.deps.db.transaction((tx) => writeSettingInternal(tx, f.deps, systemContext(), 'finance.expenseWaiversEnabled', false, 'test'));
    expect(check(unwrap(await checkConfirmable(f.deps, f.ctx, { lineIds: [line.id] })), 'expenseWaiverEnabled')).toMatchObject({ blocked: true });

    f.deps.db.update(documentTypes).set({ isActive: false }).where(eq(documentTypes.key, 'finance-confirmation')).run();
    expect(check(unwrap(await checkConfirmable(f.deps, f.ctx, { lineIds: [line.id] })), 'typeActive')).toMatchObject({ blocked: true, remedy: { labelKey: 'activateType' } });
  });

  it('an in-kind line needs its details; in-kind and money never mix', async () => {
    const f = await donationFixture();
    const gift = await f.giveInKind();
    const res = unwrap(await checkConfirmable(f.deps, f.ctx, { lineIds: [gift.line.id] }));
    expect(res.kind).toBe('inKind');
    expect(check(res, 'inKindDetails')).toMatchObject({ applies: true, blocked: true, remedy: { labelKey: 'describeInKind' } });
    // Ohne Geldfluss und ohne Wertunterlage ist die Buchung auch unbelegt.
    expect(check(res, 'documented').blocked).toBe(true);

    const money = await f.donate();
    expect(err(await checkConfirmable(f.deps, f.ctx, { lineIds: [gift.line.id, money.line.id] }))).toMatchObject({ type: 'conflict', code: 'confirmationInKindMixed' });
  });

  it('needs finance.read, validates the lines and requires one contact', async () => {
    const f = await donationFixture();
    const { line } = await f.donate();
    expect(err(await checkConfirmable(f.deps, ctxWith(['finance.overview'], f.userId), { lineIds: [line.id] }))).toMatchObject({ type: 'forbidden' });
    expect(err(await checkConfirmable(f.deps, f.ctx, { lineIds: [] }))).toMatchObject({ type: 'validation' });
    expect(err(await checkConfirmable(f.deps, f.ctx, { lineIds: [line.id], issuedOn: '20.03.2026' }))).toMatchObject({ type: 'validation' });
    expect(err(await checkConfirmable(f.deps, f.ctx, { lineIds: ['nope'] }))).toMatchObject({ type: 'notFound' });
    const other = await f.donate({ contactId: f.donor.id });
    expect(err(await checkConfirmable(f.deps, f.ctx, { lineIds: [line.id, other.line.id] }))).toMatchObject({ type: 'validation' });
    const anonymous = await f.donate({ contactId: null });
    expect(err(await checkConfirmable(f.deps, f.ctx, { lineIds: [anonymous.line.id] }))).toMatchObject({ type: 'validation' });
  });

  it('the internal check runs inside a transaction with the same answer', async () => {
    const f = await donationFixture();
    const { line } = await f.donate();
    const outside = unwrap(await checkConfirmable(f.deps, f.ctx, { lineIds: [line.id], issuedOn: '2026-03-20' }));
    const inside = f.deps.db.transaction((tx) => checkConfirmableInternal(tx, f.deps, { lineIds: [line.id], issuedOn: '2026-03-20' }));
    expect(unwrap(inside)).toEqual(outside);
  });
});
