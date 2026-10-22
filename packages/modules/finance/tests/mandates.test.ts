import { newId, schema, unwrap, type CallContext } from '@kompass/core';
import { ctxWith, systemContext } from '@kompass/core/testing';
import { createContact } from '@kompass/module-contacts';
import { documentLinks, documentRelations, documents, textPdf } from '@kompass/module-dms';
import { and, eq, like } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { activateMandate, amendMandate, correctMandate, endMandate, getMandate, listMandates, mandateState, prepareMandate } from '../src/direct-debit/mandates';
import { fileSignedMandate } from '../src/direct-debit/forms';
import { maskIban } from '../src/format/iban';
import { installFinance } from '../src/install';
import { financeContactBankAccounts, financeSepaMandateChanges, financeSepaMandates, type FinanceSepaMandateRow } from '../src/schema';
import { insertDocument, setupFinance } from './helpers';

// TEST_NOW: 2026-09-05
const IBAN = 'DE44999999990532013000';
const NEW_IBAN = 'DE23999999990000202051';
const fail = <T>(res: { ok: boolean; error?: T }) => (res.ok ? null : res.error);

async function setup() {
  const f = setupFinance();
  f.deps.db.transaction((tx) => installFinance(tx, f.deps, systemContext()));
  const contactCtx: CallContext = { ...f.ctx, permissions: new Set(['contacts.manage']) };
  const payer = unwrap(await createContact(f.deps, contactCtx, { kind: 'person', firstName: 'Erika', lastName: 'Beispiel' }));
  const prepare = (over: Record<string, unknown> = {}) => prepareMandate(f.deps, f.ctx, { contactId: payer.id, debtorName: 'Erika Beispiel', iban: 'de44 9999 9999 0532 0130 00', ...over });
  return { ...f, payer, prepare };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** Ein eingegangenes, festgeschriebenes Dokument am Kontakt — die unterschriebene Rücksendung. */
function signedReturn(f: Setup, opts: { linkContact?: boolean } = {}): string {
  const id = insertDocument(f, { subject: 'Mandat unterschrieben', typeKey: 'voucher-own' });
  if (opts.linkContact !== false) f.deps.db.insert(documentLinks).values({ id: newId(), documentId: id, entityType: 'contact', entityId: f.payer.id, role: 'sender', createdAt: '2026-09-01T10:00:00.000Z' }).run();
  return id;
}

async function active(f: Setup) {
  const mandate = unwrap(await f.prepare());
  unwrap(await activateMandate(f.deps, f.ctx, { mandateId: mandate.id, signedOn: '2026-09-01', signedDocumentId: signedReturn(f) }));
  return mandate;
}

const auditOf = (f: Setup, prefix = 'finance.mandate.') => f.deps.db.select().from(schema.auditLog).where(like(schema.auditLog.action, `${prefix}%`)).all();

describe('prepareMandate', () => {
  it('draws MND-000001, MND-000002 from the counter, stores the IBAN compact and learns it for the contact', async () => {
    const f = await setup();
    const first = unwrap(await f.prepare());
    const second = unwrap(await f.prepare());
    expect([first.reference, second.reference]).toEqual(['MND-000001', 'MND-000002']);
    expect(first).toMatchObject({ iban: IBAN, sequence: 'recurring', preparedOn: '2026-09-05', state: 'pending' });
    expect(f.deps.db.select().from(financeContactBankAccounts).where(eq(financeContactBankAccounts.contactId, f.payer.id)).all().map((r) => r.iban)).toEqual([IBAN]);
    expect(auditOf(f).map((e) => [e.action, e.params])).toEqual([
      ['finance.mandate.prepare', JSON.stringify({ reference: 'MND-000001' })],
      ['finance.mandate.prepare', JSON.stringify({ reference: 'MND-000002' })],
    ]);
  });

  it('needs finance.directDebit, a valid IBAN, a name within 70 characters and an existing contact', async () => {
    const f = await setup();
    expect(fail(await prepareMandate(f.deps, ctxWith(['finance.read'], f.userId), { contactId: f.payer.id, debtorName: 'Erika Beispiel', iban: IBAN }))).toMatchObject({ type: 'forbidden' });
    expect(fail(await f.prepare({ iban: 'DE02999999990532013000' }))).toMatchObject({ type: 'validation' });
    expect(fail(await f.prepare({ debtorName: 'x'.repeat(71) }))).toMatchObject({ type: 'validation' });
    expect(fail(await f.prepare({ contactId: 'NOPE' }))).toMatchObject({ type: 'notFound' });
  });
});

describe('correctMandate', () => {
  it('corrects a pending mandate in place; after the signature it is an amendment (mandateSigned)', async () => {
    const f = await setup();
    const mandate = unwrap(await f.prepare());
    expect(unwrap(await correctMandate(f.deps, f.ctx, { mandateId: mandate.id, iban: NEW_IBAN, debtorName: 'Erika B. Beispiel' }))).toMatchObject({ iban: NEW_IBAN, debtorName: 'Erika B. Beispiel', reference: 'MND-000001' });
    expect(f.deps.db.select().from(financeSepaMandateChanges).all()).toEqual([]);
    unwrap(await activateMandate(f.deps, f.ctx, { mandateId: mandate.id, signedOn: '2026-09-01', signedDocumentId: signedReturn(f) }));
    expect(fail(await correctMandate(f.deps, f.ctx, { mandateId: mandate.id, iban: IBAN }))).toMatchObject({ type: 'conflict', code: 'mandateSigned' });
  });
});

describe('activateMandate', () => {
  it('without a document → validation; a draft → documentNotFinal; a voided one → documentVoided; an unrelated one → mandateDocumentUnrelated', async () => {
    const f = await setup();
    const mandate = unwrap(await f.prepare());
    expect(fail(await activateMandate(f.deps, f.ctx, { mandateId: mandate.id, signedOn: '2026-09-01' }))).toMatchObject({ type: 'validation' });
    const draft = signedReturn(f);
    f.deps.db.update(documents).set({ phase: 'draft', number: null }).where(eq(documents.id, draft)).run();
    expect(fail(await activateMandate(f.deps, f.ctx, { mandateId: mandate.id, signedOn: '2026-09-01', signedDocumentId: draft }))).toMatchObject({ code: 'documentNotFinal' });
    const voided = insertDocument(f, { subject: 'storniert', voided: true });
    expect(fail(await activateMandate(f.deps, f.ctx, { mandateId: mandate.id, signedOn: '2026-09-01', signedDocumentId: voided }))).toMatchObject({ code: 'documentVoided' });
    expect(fail(await activateMandate(f.deps, f.ctx, { mandateId: mandate.id, signedOn: '2026-09-01', signedDocumentId: signedReturn(f, { linkContact: false }) }))).toMatchObject({ code: 'mandateDocumentUnrelated' });
    expect(fail(await activateMandate(f.deps, f.ctx, { mandateId: mandate.id, signedOn: '2026-09-01', signedDocumentId: 'NOPE' }))).toMatchObject({ type: 'notFound' });
  });

  it('refuses a signature date in the future', async () => {
    const f = await setup();
    const mandate = unwrap(await f.prepare());
    const doc = signedReturn(f);
    expect(fail(await activateMandate(f.deps, f.ctx, { mandateId: mandate.id, signedOn: '2026-09-06', signedDocumentId: doc }))).toMatchObject({ type: 'validation' });
  });

  it('accepts the signed copy of the form, links the document to the mandate and logs reference and day', async () => {
    const f = await setup();
    const mandate = unwrap(await f.prepare());
    const form = insertDocument(f, { subject: 'SEPA-Lastschriftmandat MND-000001', typeKey: 'voucher-own' });
    f.deps.db.insert(documentLinks).values({ id: newId(), documentId: form, entityType: 'financeMandate', entityId: mandate.id, role: 'about', createdAt: '2026-09-01T10:00:00.000Z' }).run();
    const scan = signedReturn(f, { linkContact: false });
    f.deps.db.insert(documentRelations).values({ id: newId(), documentId: scan, relatedDocumentId: form, kind: 'signedCopyOf', createdByUserId: f.userId, createdAt: '2026-09-02T10:00:00.000Z' }).run();
    const activated = unwrap(await activateMandate(f.deps, f.ctx, { mandateId: mandate.id, signedOn: '2026-09-02', signedDocumentId: scan }));
    expect(activated).toMatchObject({ state: 'active', signedOn: '2026-09-02', signedDocumentId: scan, expiresOn: '2029-09-02' });
    expect(f.deps.db.select().from(documentLinks).where(and(eq(documentLinks.documentId, scan), eq(documentLinks.entityType, 'financeMandate'))).all()).toHaveLength(1);
    expect(auditOf(f).at(-1)).toMatchObject({ action: 'finance.mandate.activate', params: JSON.stringify({ reference: 'MND-000001', signedOn: '2026-09-02' }) });
    // Zweimal aktivieren geht nicht.
    expect(fail(await activateMandate(f.deps, f.ctx, { mandateId: mandate.id, signedOn: '2026-09-02', signedDocumentId: scan }))).toMatchObject({ code: 'mandateSigned' });
  });
});

describe('amendMandate', () => {
  it('records the change and keeps the old IBAN as pending amendment for the next collection (Review Focus 2)', async () => {
    const f = await setup();
    const mandate = await active(f);
    const amended = unwrap(await amendMandate(f.deps, f.ctx, { mandateId: mandate.id, iban: NEW_IBAN, validFrom: '2026-10-01' }));
    expect(amended).toMatchObject({ iban: NEW_IBAN, pendingAmendment: { originalIban: IBAN, since: '2026-10-01' } });
    expect(f.deps.db.select().from(financeSepaMandateChanges).all()).toMatchObject([{ mandateId: mandate.id, field: 'iban', before: IBAN, after: NEW_IBAN, validFrom: '2026-10-01' }]);
    // Eine zweite Änderung vor dem nächsten Einzug: die IBAN des letzten Einzugs bleibt der Hinweis.
    unwrap(await amendMandate(f.deps, f.ctx, { mandateId: mandate.id, iban: 'DE66999999991234567890', validFrom: '2026-10-15' }));
    expect(f.deps.db.select().from(financeSepaMandates).get()!.pendingAmendment).toEqual({ originalIban: IBAN, since: '2026-10-01' });
    // Ein neuer Kontoinhaber allein braucht keinen Hinweis für die Bank.
    const other = await active(f);
    unwrap(await amendMandate(f.deps, f.ctx, { mandateId: other.id, debtorName: 'Erika Muster', validFrom: '2026-10-01' }));
    expect(f.deps.db.select().from(financeSepaMandates).where(eq(financeSepaMandates.id, other.id)).get()!.pendingAmendment).toBeNull();
    expect(auditOf(f, 'finance.mandate.amend').map((e) => e.params)).toEqual([
      JSON.stringify({ reference: 'MND-000001', field: 'iban' }),
      JSON.stringify({ reference: 'MND-000001', field: 'iban' }),
      JSON.stringify({ reference: 'MND-000002', field: 'debtorName' }),
    ]);
  });

  it('only for an active mandate, and only with a change', async () => {
    const f = await setup();
    const pending = unwrap(await f.prepare());
    expect(fail(await amendMandate(f.deps, f.ctx, { mandateId: pending.id, iban: NEW_IBAN, validFrom: '2026-10-01' }))).toMatchObject({ code: 'mandateNotActive' });
    const mandate = await active(f);
    expect(fail(await amendMandate(f.deps, f.ctx, { mandateId: mandate.id, iban: IBAN, validFrom: '2026-10-01' }))).toMatchObject({ type: 'validation' });
  });
});

describe('mandateState', () => {
  const row = (over: Partial<FinanceSepaMandateRow>) => ({ signedOn: null, endedOn: null, lastCollectedOn: null, ...over }) as FinanceSepaMandateRow;
  it('expires the day after 36 months without collection, counted from the last one, else from the signature (Review Focus 3)', () => {
    expect(mandateState(row({}), '2026-09-05')).toBe('pending');
    expect(mandateState(row({ signedOn: '2023-09-05' }), '2026-09-05')).toBe('active');
    expect(mandateState(row({ signedOn: '2023-09-05' }), '2026-09-06')).toBe('expired');
    expect(mandateState(row({ signedOn: '2020-01-10', lastCollectedOn: '2023-09-05' }), '2026-09-05')).toBe('active');
    expect(mandateState(row({ signedOn: '2020-01-10', lastCollectedOn: '2023-09-05' }), '2026-09-06')).toBe('expired');
    expect(mandateState(row({ signedOn: '2026-01-01', endedOn: '2026-09-05' }), '2026-09-05')).toBe('ended');
    expect(mandateState(row({ signedOn: '2026-01-01', endedOn: '2026-09-30' }), '2026-09-05')).toBe('active');
  });
});

describe('endMandate', () => {
  it('ends a mandate once and logs reference and reason', async () => {
    const f = await setup();
    const mandate = await active(f);
    expect(unwrap(await endMandate(f.deps, f.ctx, { mandateId: mandate.id, endedOn: '2026-09-05', reason: 'debtor' }))).toMatchObject({ state: 'ended', endedOn: '2026-09-05', endReason: 'debtor' });
    expect(fail(await endMandate(f.deps, f.ctx, { mandateId: mandate.id, endedOn: '2026-09-05', reason: 'debtor' }))).toMatchObject({ code: 'mandateEnded', params: { reference: 'MND-000001', date: '2026-09-05' } });
    expect(auditOf(f, 'finance.mandate.end').map((e) => e.params)).toEqual([JSON.stringify({ reference: 'MND-000001', reason: 'debtor' })]);
  });
});

describe('getMandate and listMandates', () => {
  it('shows the full IBAN in the detail, a masked one in the list, filters by state and needs finance.read', async () => {
    const f = await setup();
    const one = await active(f);
    unwrap(await f.prepare({ debtorName: 'Max Muster' }));
    expect(unwrap(await getMandate(f.deps, f.ctx, { id: one.id }))).toMatchObject({ iban: IBAN, state: 'active', contactName: 'Erika Beispiel', usedFor: [] });
    const list = unwrap(await listMandates(f.deps, f.ctx, { limit: 50, offset: 0 }));
    expect(list.total).toBe(2);
    expect(list.items.map((m) => m.iban)).toEqual([maskIban(IBAN), maskIban(IBAN)]);
    expect(unwrap(await listMandates(f.deps, f.ctx, { state: 'pending', limit: 50, offset: 0 })).items.map((m) => m.debtorName)).toEqual(['Max Muster']);
    expect(unwrap(await listMandates(f.deps, f.ctx, { search: 'max', limit: 50, offset: 0 })).total).toBe(1);
    expect(fail(await getMandate(f.deps, ctxWith(['finance.directDebit'], f.userId), { id: one.id }))).toMatchObject({ type: 'forbidden' });
  });

  it('never writes an IBAN into the audit log', async () => {
    const f = await setup();
    const mandate = await active(f);
    unwrap(await amendMandate(f.deps, f.ctx, { mandateId: mandate.id, iban: NEW_IBAN, validFrom: '2026-10-01' }));
    unwrap(await endMandate(f.deps, f.ctx, { mandateId: mandate.id, endedOn: '2026-12-31', reason: 'creditor' }));
    const pending = unwrap(await f.prepare());
    unwrap(await correctMandate(f.deps, f.ctx, { mandateId: pending.id, iban: NEW_IBAN }));
    const entries = f.deps.db.select().from(schema.auditLog).all();
    expect(entries.filter((e) => e.action.startsWith('finance.mandate.')).length).toBeGreaterThanOrEqual(5);
    for (const e of entries) expect(`${e.params ?? ''}${e.after ?? ''}${e.before ?? ''}`, e.action).not.toMatch(/DE\d{2}/);
  });
});

describe('fileSignedMandate', () => {
  it('files the signed return at the mandate and sets it active with the day of the signature (Handoff 2a § 1.4)', async () => {
    const f = await setup();
    const mandate = unwrap(await f.prepare());
    const bytes = textPdf(['SEPA-Lastschriftmandat', 'unterschrieben']);
    expect(fail(await fileSignedMandate(f.deps, f.ctx, { mandateId: mandate.id, signedOn: '2026-09-06', bytes }))).toMatchObject({ type: 'validation' });
    expect(fail(await fileSignedMandate(f.deps, ctxWith(['finance.read'], f.userId), { mandateId: mandate.id, signedOn: '2026-09-01', bytes }))).toMatchObject({ type: 'forbidden' });
    const activated = unwrap(await fileSignedMandate(f.deps, f.ctx, { mandateId: mandate.id, signedOn: '2026-09-01', bytes }));
    expect(activated).toMatchObject({ state: 'active', signedOn: '2026-09-01' });
    const doc = f.deps.db.select().from(documents).where(eq(documents.id, activated.signedDocumentId!)).get()!;
    expect(doc).toMatchObject({ phase: 'issued', documentDate: '2026-09-01' });
    expect(auditOf(f).at(-1)).toMatchObject({ action: 'finance.mandate.activate' });
    // Schon unterschrieben: kein zweites Dokument.
    expect(fail(await fileSignedMandate(f.deps, f.ctx, { mandateId: mandate.id, signedOn: '2026-09-01', bytes }))).toMatchObject({ code: 'mandateSigned' });
  });
});
