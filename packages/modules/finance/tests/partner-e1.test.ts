import { unwrap } from '@kompass/core';
import { createContact } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { getPartner, listPartnerNotices, listPartners, savePartnerNotice, savePartnerProfile } from '../src/allocation/partners';
import { savePartnerPaymentDraft, submitPartnerPayment } from '../src/allocation/partner-payments';
import { insertDocument, ledgerFixture } from './helpers';
import { insertPaidPartnerPayment } from './partner-fixture';

async function org(f: Awaited<ReturnType<typeof ledgerFixture>>, name: string, extra: Record<string, unknown> = {}) {
  return unwrap(await createContact(f.deps, { ...f.ctx, permissions: new Set(['contacts.manage']) }, { kind: 'organization', name, ...extra }));
}

describe('E1 Partner (Design-Nachtrag Phase 4, Task 4)', () => {
  it('zeigt die Rechtsform vom Kontakt der Organisation — nie ein eigenes Feld am Partner (Entscheidung 1)', async () => {
    const f = await ledgerFixture();
    const contact = await org(f, 'Stiftung Beispielland', { legalForm: 'Stiftung nach örtlichem Recht' });
    const partner = unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: contact.id, status: 'foreignBody', usualBasis: 'agent57' }));
    expect(partner.contactLegalForm).toBe('Stiftung nach örtlichem Recht');
    expect(Object.keys(partner)).not.toContain('legalForm');
  });

  it('führt je Partner offene und überfällige Nachweise und den letzten Zahlungstag', async () => {
    const f = await ledgerFixture();
    const contact = await org(f, 'Zahlenpartner e.V.');
    const partner = unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: contact.id, status: 'publicBody' }));
    await insertPaidPartnerPayment(f, partner.id, contact.id, '2026-01-05', { number: 'PZ-2026-901', proofMonths: 1 });
    await insertPaidPartnerPayment(f, partner.id, contact.id, '2026-02-05', { number: 'PZ-2026-902', proofMonths: 60 });
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: partner.id, basis: 'transfer58', purposeText: 'x', retroactive: false, positions: [{ kind: 'money', amountCents: 100, categoryId: f.programCosts.id }] }));
    unwrap(await submitPartnerPayment(f.deps, f.ctx, { id: draft.id, expectedVersion: draft.version, overdueReason: 'Test' }));
    const [listed] = unwrap(await listPartners(f.deps, f.ctx, {})).filter((p) => p.id === partner.id);
    expect(listed).toMatchObject({ openProofCount: 2, overdueProofCount: 1, lastPaidOn: '2026-02-05' });
    expect(unwrap(await getPartner(f.deps, f.ctx, { id: partner.id }))).toMatchObject({ openProofCount: 2, overdueProofCount: 1 });
  });

  it('nimmt bei einem Partner im Ausland die „Anerkennung im Sitzland“ mit „gültig bis“ an — ohne Wirkung auf die Bescheid-Prüfung (Entscheidung 3)', async () => {
    const f = await ledgerFixture();
    const contact = await org(f, 'Auslandspartner Sitzland');
    const partner = unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: contact.id, status: 'foreignBody', usualBasis: 'transfer58' }));
    const doc = insertDocument(f, { subject: 'Anerkennung', typeKey: 'voucher-invoice' });
    const saved = unwrap(await savePartnerNotice(f.deps, f.ctx, { partnerId: partner.id, kind: 'recognitionAbroad', noticeDate: '2025-12-01', validUntil: '2027-12-31', receivedOn: '2026-02-04', documentId: doc }));
    expect(saved).toMatchObject({ kind: 'recognitionAbroad', validUntil: '2027-12-31', receivedOn: '2026-02-04' });
    expect(unwrap(await listPartnerNotices(f.deps, f.ctx, { partnerId: partner.id }))).toHaveLength(1);
    // Ohne „gültig bis“ kein Nachweis aus dem Sitzland; und ein deutscher Bescheid passt nicht zu einem Partner im Ausland.
    expect(await savePartnerNotice(f.deps, f.ctx, { partnerId: partner.id, kind: 'recognitionAbroad', noticeDate: '2025-12-01', documentId: doc })).toMatchObject({ ok: false });
    expect(await savePartnerNotice(f.deps, f.ctx, { partnerId: partner.id, kind: 'exemptionNotice', noticeDate: '2025-12-01', documentId: doc })).toMatchObject({ ok: false });
    // Die Zahlung an diesen Partner fragt nie nach dem Bescheid.
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { partnerId: partner.id, basis: 'transfer58', purposeText: 'x', retroactive: false, positions: [] }));
    expect(draft.reasonsNeeded.notice).toBe(false);
    // Bei einer gemeinnützigen Organisation im Inland bleibt die Art aus dem Sitzland ausgeschlossen.
    const inland = unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: (await org(f, 'Inland e.V.')).id, status: 'taxExemptBody' }));
    expect(await savePartnerNotice(f.deps, f.ctx, { partnerId: inland.id, kind: 'recognitionAbroad', noticeDate: '2025-12-01', validUntil: '2027-12-31', documentId: doc })).toMatchObject({ ok: false });
  });
});
