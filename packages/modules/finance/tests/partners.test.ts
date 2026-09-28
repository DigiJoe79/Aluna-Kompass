import { schema, unwrap } from '@kompass/core';
import { createContact } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { checkBasisAllowed, getPartner, listPartners, listPartnerNotices, partnerNoticeValidAtInternal, savePartnerNotice, savePartnerProfile, setPartnerActive, deletePartnerProfile, voidPartnerNotice } from '../src/allocation/partners';
import { financePartnerProfiles } from '../src/schema';
import { insertDocument, ledgerFixture } from './helpers';
import { insertPartner, insertPartnerNotice, insertPartnerPayment } from './partner-fixture';
import { eq } from 'drizzle-orm';

async function orgContact(f: Awaited<ReturnType<typeof ledgerFixture>>, name: string) {
  return unwrap(await createContact(f.deps, { ...f.ctx, permissions: new Set(['contacts.manage']) }, { kind: 'organization', name }));
}

describe('savePartnerProfile — Angaben zum Partner (F7 Task 2)', () => {
  it('derives the usual basis from the status: a funding transfer for a tax-exempt or public body, an agent mandate for an agent', async () => {
    const f = await ledgerFixture();
    const org = await orgContact(f, 'Beispielverein e.V.');
    const org2 = await orgContact(f, 'Zweitverein e.V.');
    const org3 = await orgContact(f, 'Amt Beispielstadt');
    const a = unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: org.id, status: 'taxExemptBody' }));
    expect(a).toMatchObject({ usualBasis: 'transfer58', basisDerived: true });
    const b = unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: org2.id, status: 'agent' }));
    expect(b).toMatchObject({ usualBasis: 'agent57', basisDerived: true });
    const c = unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: org3.id, status: 'publicBody' }));
    expect(c).toMatchObject({ usualBasis: 'transfer58', basisDerived: true });
  });

  it('requires a choice of basis for a partner abroad, and remembers it as not derived', async () => {
    const f = await ledgerFixture();
    const org = await orgContact(f, 'Auslandsverein');
    const missing = await savePartnerProfile(f.deps, f.ctx, { contactId: org.id, status: 'foreignBody' });
    expect(missing.ok).toBe(false);
    const chosen = unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: org.id, status: 'foreignBody', usualBasis: 'agent57' }));
    expect(chosen).toMatchObject({ usualBasis: 'agent57', basisDerived: false });
  });

  it('refuses a funding transfer as basis whenever the partner is an agent, or the contact is a person (Review Focus 6, shared check reused by Task 3)', () => {
    expect(checkBasisAllowed('transfer58', 'agent', 'organization')).toMatchObject({ ok: false, error: { code: 'partnerBasisNotForAgent' } });
    expect(checkBasisAllowed('transfer58', 'taxExemptBody', 'person')).toMatchObject({ ok: false, error: { code: 'partnerBasisNeedsOrganization' } });
    expect(checkBasisAllowed('transfer58', 'taxExemptBody', 'organization')).toBeNull();
    expect(checkBasisAllowed('agent57', 'agent', 'person')).toBeNull();
  });

  it('never accepts a usual basis for an agent other than the derived one — a partner led as agent always ends up with agent57', async () => {
    const f = await ledgerFixture();
    const org = await orgContact(f, 'Vermittlerverein');
    unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: org.id, status: 'agent' }));
    const row = f.deps.db.select().from(financePartnerProfiles).where(eq(financePartnerProfiles.contactId, org.id)).get()!;
    expect(row.usualBasis).toBe('agent57');
  });

  it('refuses transfer58 as usual basis for a person', async () => {
    const f = await ledgerFixture();
    const denied = await savePartnerProfile(f.deps, f.ctx, { contactId: f.donor.id, status: 'foreignBody', usualBasis: 'transfer58' });
    expect(denied.ok).toBe(false);
    expect(JSON.stringify(denied)).toContain('partnerBasisNeedsOrganization');
    const allowed = unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: f.donor.id, status: 'foreignBody', usualBasis: 'agent57' }));
    expect(allowed.usualBasis).toBe('agent57');
  });

  it('allows only one profile per contact', async () => {
    const f = await ledgerFixture();
    const org = await orgContact(f, 'Nur einmal e.V.');
    unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: org.id, status: 'taxExemptBody' }));
    const again = await savePartnerProfile(f.deps, f.ctx, { contactId: org.id, status: 'publicBody' });
    expect(again.ok).toBe(false);
  });

  it('requires finance.entriesWrite to save, and finance.read to list and read', async () => {
    const f = await ledgerFixture();
    const org = await orgContact(f, 'Rechtecheck e.V.');
    const noWrite = { ...f.ctx, permissions: new Set(['finance.read']) };
    expect((await savePartnerProfile(f.deps, noWrite, { contactId: org.id, status: 'taxExemptBody' })).ok).toBe(false);
    const created = unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: org.id, status: 'taxExemptBody' }));
    const noRead = { ...f.ctx, permissions: new Set(['finance.entriesWrite']) };
    expect((await getPartner(f.deps, noRead, { id: created.id })).ok).toBe(false);
    expect(unwrap(await getPartner(f.deps, f.ctx, { id: created.id }))).toMatchObject({ id: created.id });
  });

  it('sets active/inactive and deletes only a partner without payments or notices', async () => {
    const f = await ledgerFixture();
    const org = await orgContact(f, 'Deaktivierbar e.V.');
    const created = unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: org.id, status: 'taxExemptBody' }));
    const off = unwrap(await setPartnerActive(f.deps, f.ctx, { id: created.id, isActive: false }));
    expect(off.isActive).toBe(false);
    expect(unwrap(await deletePartnerProfile(f.deps, f.ctx, { id: created.id }))).toBeNull();

    const org2 = await orgContact(f, 'Mit Vorgang e.V.');
    const withPayment = unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: org2.id, status: 'taxExemptBody' }));
    insertPartnerPayment(f.deps.db, withPayment.id, { state: 'submitted', submittedAt: '2026-03-02T10:00:00.000Z' });
    const blocked = await deletePartnerProfile(f.deps, f.ctx, { id: withPayment.id });
    expect(blocked.ok).toBe(false);
  });

  it('lists partners by contact name, active ones by default', async () => {
    const f = await ledgerFixture();
    const orgB = await orgContact(f, 'Bäckerei Beispiel');
    const orgA = await orgContact(f, 'Amt Anfang');
    unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: orgB.id, status: 'taxExemptBody' }));
    const inactive = unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: orgA.id, status: 'publicBody' }));
    unwrap(await setPartnerActive(f.deps, f.ctx, { id: inactive.id, isActive: false }));
    const active = unwrap(await listPartners(f.deps, f.ctx, {}));
    expect(active.map((p) => p.contactName)).toEqual(['Bäckerei Beispiel']);
    const all = unwrap(await listPartners(f.deps, f.ctx, { includeInactive: true }));
    expect(all.map((p) => p.contactName)).toEqual(['Amt Anfang', 'Bäckerei Beispiel']);
  });
});

describe('savePartnerNotice — Empfängerbescheide (F7 Task 2)', () => {
  it('only accepts a notice for a partner led as a tax-exempt body', async () => {
    const f = await ledgerFixture();
    const org = await orgContact(f, 'Amtspartner');
    const partner = unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: org.id, status: 'publicBody' }));
    const docId = insertDocument(f, { subject: 'Bescheid', typeKey: 'voucher-invoice' });
    const denied = await savePartnerNotice(f.deps, f.ctx, { partnerId: partner.id, kind: 'exemptionNotice', noticeDate: '2025-01-01', documentId: docId });
    expect(denied.ok).toBe(false);
  });

  it('takes the received date from the document, and falls back to today', async () => {
    const f = await ledgerFixture();
    const org = await orgContact(f, 'Empfangspartner');
    const partner = unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: org.id, status: 'taxExemptBody' }));
    const docId = insertDocument(f, { subject: 'Bescheid', typeKey: 'voucher-invoice' });
    const notice = unwrap(await savePartnerNotice(f.deps, f.ctx, { partnerId: partner.id, kind: 'exemptionNotice', noticeDate: '2025-01-01', documentId: docId }));
    expect(notice.receivedOn).toBe('2026-03-01');
  });

  it('lists, voids and computes validity at a date — a voided notice never counts', async () => {
    const f = await ledgerFixture();
    const org = await orgContact(f, 'Prüfpartner');
    const partner = unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: org.id, status: 'taxExemptBody' }));
    const docId = insertDocument(f, { subject: 'Bescheid', typeKey: 'voucher-invoice' });
    const notice = unwrap(await savePartnerNotice(f.deps, f.ctx, { partnerId: partner.id, kind: 'exemptionNotice', noticeDate: '2025-01-01', documentId: docId }));
    expect(partnerNoticeValidAtInternal(f.deps.db, partner.id, '2026-03-02')).toMatchObject({ id: notice.id });
    unwrap(await voidPartnerNotice(f.deps, f.ctx, { id: notice.id, note: 'Falscher Partner erfasst' }));
    expect(partnerNoticeValidAtInternal(f.deps.db, partner.id, '2026-03-02')).toBeNull();
    const list = unwrap(await listPartnerNotices(f.deps, f.ctx, { partnerId: partner.id }));
    expect(list).toHaveLength(1);
    expect(list[0]!.state).toBe('voided');
  });

  it('never lets the void note into the audit log — it stays on the record itself', async () => {
    const f = await ledgerFixture();
    const partnerId = insertPartner(f.deps.db, { contactId: f.donor.id });
    const noticeId = insertPartnerNotice(f.deps.db, partnerId);
    const voided = unwrap(await voidPartnerNotice(f.deps, f.ctx, { id: noticeId, note: 'Vertraulicher Grund' }));
    expect(voided.voidNote).toBe('Vertraulicher Grund');
    const log = f.deps.db.select().from(schema.auditLog).all().filter((e) => e.action === 'finance.partnerNotice.void');
    expect(JSON.stringify(log)).not.toContain('Vertraulicher Grund');
  });
});
