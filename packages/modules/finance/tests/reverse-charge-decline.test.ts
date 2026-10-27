import { unwrap } from '@kompass/core';
import { auditEntry, ctxWith, systemContext } from '@kompass/core/testing';
import { createContact } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { clearReverseChargeDecline, declineReverseCharge, getContactTaxDetails, saveContactTaxDetails } from '../src/allocation/contact-tax-details';
import { ledgerFixture } from './helpers';

type F = Awaited<ReturnType<typeof ledgerFixture>>;
const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? null : (r.error as { type: string; code?: string; issues?: { path: string; message: string }[] }));
const code = (r: { ok: boolean; error?: unknown }) => { const e = err(r); return e ? (e.code ?? e.type) : 'ok'; };
const fields = (r: { ok: boolean; error?: unknown }) => (err(r)?.issues ?? []).map((i) => `${i.path}:${i.message}`);

const provider = async (f: F) => unwrap(await createContact(f.deps, { ...systemContext(), permissions: new Set(['contacts.manage']) }, { kind: 'organization', name: 'Zahlfix Test S.à r.l.', country: 'LU' }));
const details = async (f: F, contactId: string) => unwrap(await getContactTaxDetails(f.deps, f.ctx, { contactId }))!;
const auditCount = (f: F, action: string) => f.deps.sqlite.prepare('select count(*) as n from audit_log where action = ?').get(action) as { n: number };

/** Plan E6b Task 1 — begründetes Nein zu § 13b je Kontakt. */
describe('reverse charge decline', () => {
  it('remembers a reasoned no', async () => {
    const f = await ledgerFixture();
    f.deps.clock.set('2026-10-25T09:00:00.000Z');
    const c = await provider(f);
    unwrap(await declineReverseCharge(f.deps, f.ctx, { contactId: c.id, reason: 'paymentServices' }));
    expect((await details(f, c.id)).reverseChargeDecline).toEqual({ reason: 'paymentServices', text: null, on: '2026-10-25', byUserId: f.userId });
    const audit = auditEntry(f.deps, 'finance.contactTaxDetails.reverseChargeDecline');
    expect(JSON.parse(audit.params!)).toEqual({ reason: 'paymentServices' });
    expect(JSON.stringify(audit)).not.toContain(c.id);
    expect(code(await declineReverseCharge(f.deps, ctxWith(['finance.read'], f.userId), { contactId: c.id, reason: 'paymentServices' }))).toBe('forbidden');
    expect(code(await declineReverseCharge(f.deps, f.ctx, { contactId: 'unbekannt', reason: 'paymentServices' }))).toBe('notFound');
  });

  it('requires text for other', async () => {
    const f = await ledgerFixture();
    const c = await provider(f);
    expect(fields(await declineReverseCharge(f.deps, f.ctx, { contactId: c.id, reason: 'other' }))).toEqual(['text:required']);
    expect(fields(await declineReverseCharge(f.deps, f.ctx, { contactId: c.id, reason: 'other', text: '   ' }))).toEqual(['text:required']);
    unwrap(await declineReverseCharge(f.deps, f.ctx, { contactId: c.id, reason: 'other', text: '  Messe-Eintritt im Ausland  ' }));
    expect((await details(f, c.id)).reverseChargeDecline).toMatchObject({ reason: 'other', text: 'Messe-Eintritt im Ausland' });
    const audit = auditEntry(f.deps, 'finance.contactTaxDetails.reverseChargeDecline');
    expect(JSON.stringify(audit)).not.toContain('Messe-Eintritt');
    unwrap(await declineReverseCharge(f.deps, f.ctx, { contactId: c.id, reason: 'domesticProvider', text: 'verworfen' }));
    expect((await details(f, c.id)).reverseChargeDecline).toMatchObject({ reason: 'domesticProvider', text: null });
  });

  it('clears the no when the feature is set and on ask again', async () => {
    const f = await ledgerFixture();
    const c = await provider(f);
    unwrap(await declineReverseCharge(f.deps, f.ctx, { contactId: c.id, reason: 'paymentServices' }));
    unwrap(await saveContactTaxDetails(f.deps, f.ctx, { contactId: c.id, reverseCharge: 'eu' }));
    expect(await details(f, c.id)).toMatchObject({ reverseCharge: 'eu', reverseChargeDecline: null });
    unwrap(await declineReverseCharge(f.deps, f.ctx, { contactId: c.id, reason: 'exception13b6' }));
    expect(await details(f, c.id)).toMatchObject({ reverseCharge: null, reverseChargeDecline: { reason: 'exception13b6' } });
    unwrap(await clearReverseChargeDecline(f.deps, f.ctx, { contactId: c.id }));
    expect((await details(f, c.id)).reverseChargeDecline).toBeNull();
    expect(auditCount(f, 'finance.contactTaxDetails.reverseChargeAsk').n).toBe(1);
    unwrap(await clearReverseChargeDecline(f.deps, f.ctx, { contactId: c.id }));
    expect(auditCount(f, 'finance.contactTaxDetails.reverseChargeAsk').n).toBe(1);
    // „Wieder fragen“ löscht nur das Nein, nicht das Merkmal.
    unwrap(await saveContactTaxDetails(f.deps, f.ctx, { contactId: c.id, reverseCharge: 'other' }));
    unwrap(await clearReverseChargeDecline(f.deps, f.ctx, { contactId: c.id }));
    expect((await details(f, c.id)).reverseCharge).toBe('other');
    expect(code(await clearReverseChargeDecline(f.deps, ctxWith(['finance.read'], f.userId), { contactId: c.id }))).toBe('forbidden');
  });
});
