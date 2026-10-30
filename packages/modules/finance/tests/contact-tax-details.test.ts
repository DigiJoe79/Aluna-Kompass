import { unwrap } from '@kompass/core';
import { auditEntry, ctxWith } from '@kompass/core/testing';
import { createContact } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { getContactTaxDetails, saveContactTaxDetails } from '../src/allocation/contact-tax-details';
import { ledgerFixture } from './helpers';

const code = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : ((r.error as { code?: string; type: string }).code ?? (r.error as { type: string }).type));

describe('juristische Person an den Finanzangaben zum Kontakt (J1 Task 3)', () => {
  it('nur bei Organisationen; null setzt zurück; das Protokoll trägt den Code', async () => {
    const f = await ledgerFixture();
    const manage = ctxWith(['contacts.manage']);
    const person = unwrap(await createContact(f.deps, manage, { kind: 'person', firstName: 'Erika', lastName: 'Beispiel' }));
    const org = unwrap(await createContact(f.deps, manage, { kind: 'organization', name: 'Stiftung Beispiel' }));
    expect(code(await saveContactTaxDetails(f.deps, f.ctx, { contactId: person.id, legalEntity: 'yes' }))).toBe('legalEntityOnlyOrganizations');
    expect(code(await saveContactTaxDetails(f.deps, f.ctx, { contactId: person.id, legalEntity: 'no' }))).toBe('legalEntityOnlyOrganizations');
    expect(code(await saveContactTaxDetails(f.deps, f.ctx, { contactId: person.id, legalEntity: null }))).toBe('ok');
    unwrap(await saveContactTaxDetails(f.deps, f.ctx, { contactId: org.id, legalEntity: 'yes' }));
    expect(unwrap(await getContactTaxDetails(f.deps, f.ctx, { contactId: org.id }))).toMatchObject({ legalEntity: 'yes', contactKind: 'organization', nameConsents: [] });
    expect(JSON.parse(auditEntry(f.deps, 'finance.contactTaxDetails.save').after!)).toMatchObject({ legalEntity: 'yes' });
    // Ein anderes Feld lässt das Merkmal stehen.
    unwrap(await saveContactTaxDetails(f.deps, f.ctx, { contactId: org.id, taxOffice: 'Finanzamt Musterstadt' }));
    expect(unwrap(await getContactTaxDetails(f.deps, f.ctx, { contactId: org.id }))?.legalEntity).toBe('yes');
    unwrap(await saveContactTaxDetails(f.deps, f.ctx, { contactId: org.id, legalEntity: null }));
    expect(unwrap(await getContactTaxDetails(f.deps, f.ctx, { contactId: org.id }))?.legalEntity).toBeNull();
  });
});
