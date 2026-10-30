import { unwrap } from '@kompass/core';
import { auditEntry, ctxWith } from '@kompass/core/testing';
import { contacts, createContact } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { financeRecordDeleted } from '../src/ledger/holds';
import { afterEach, describe, expect, it } from 'vitest';
import { getContactTaxDetails } from '../src/allocation/contact-tax-details';
import { nameConsentHistoryInternal, nameConsentValidInternal, recordNameConsent } from '../src/allocation/name-consents';
import { registerNameConsentRevokedHook, unregisterNameConsentRevokedHook } from '../src/locks';
import { insertDocument, ledgerFixture } from './helpers';

const code = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : ((r.error as { code?: string; type: string }).code ?? (r.error as { type: string }).type));
const fields = (r: { ok: boolean; error?: unknown }) => (r.ok ? [] : ((r.error as { issues?: { path: string; message: string }[] }).issues ?? []).map((i) => `${i.path}:${i.message}`));

async function setup() {
  const f = await ledgerFixture();
  const person = unwrap(await createContact(f.deps, ctxWith(['contacts.manage']), { kind: 'person', firstName: 'Erika', lastName: 'Beispiel' }));
  return { f, person };
}

const seen: string[] = [];
const hook = (_deps: unknown, _ctx: unknown, contactId: string) => {
  seen.push(contactId);
};
afterEach(() => {
  unregisterNameConsentRevokedHook(hook);
  seen.length = 0;
});

describe('Einwilligung zur Namensnennung (J1 Task 3)', () => {
  it('gilt ab dem Tag der Erteilung für die Jahre ab fromYear, bis zum Widerruf, und wieder nach erneuter Erteilung', async () => {
    const { f, person } = await setup();
    unwrap(await recordNameConsent(f.deps, f.ctx, { kind: 'granted', contactId: person.id, on: '2026-01-12', fromYear: 2025 }));
    expect(nameConsentValidInternal(f.deps.db, person.id, 2025, '2026-02-01')).toBe(true);
    expect(nameConsentValidInternal(f.deps.db, person.id, 2024, '2026-02-01')).toBe(false);
    expect(nameConsentValidInternal(f.deps.db, person.id, 2025, '2026-01-11')).toBe(false);
    unwrap(await recordNameConsent(f.deps, f.ctx, { kind: 'revoked', contactId: person.id, on: '2026-05-01' }));
    expect(nameConsentValidInternal(f.deps.db, person.id, 2025, '2026-04-30')).toBe(true);
    expect(nameConsentValidInternal(f.deps.db, person.id, 2025, '2026-05-01')).toBe(false);
    const res = unwrap(await recordNameConsent(f.deps, f.ctx, { kind: 'granted', contactId: person.id, on: '2026-06-01', fromYear: 2026 }));
    expect(nameConsentValidInternal(f.deps.db, person.id, 2026, '2026-06-01')).toBe(true);
    expect(nameConsentValidInternal(f.deps.db, person.id, 2025, '2026-06-01')).toBe(false);
    expect(res.history.map((e) => [e.kind, e.on, e.fromYear])).toEqual([
      ['granted', '2026-06-01', 2026],
      ['revoked', '2026-05-01', null],
      ['granted', '2026-01-12', 2025],
    ]);
    expect(nameConsentHistoryInternal(f.deps.db, person.id)).toEqual(res.history);
  });

  it('lehnt einen Widerruf ohne geltende Einwilligung ab', async () => {
    const { f, person } = await setup();
    expect(code(await recordNameConsent(f.deps, f.ctx, { kind: 'revoked', contactId: person.id, on: '2026-05-01' }))).toBe('nameConsentNotGranted');
  });

  it('lehnt einen Tag in der Zukunft ab', async () => {
    const { f, person } = await setup();
    expect(fields(await recordNameConsent(f.deps, f.ctx, { kind: 'granted', contactId: person.id, on: '2026-09-06', fromYear: 2026 }))).toEqual(['on:inFuture']);
  });

  it('verlangt finance.entriesWrite, kennt den Kontakt und das Dokument', async () => {
    const { f, person } = await setup();
    expect(code(await recordNameConsent(f.deps, ctxWith(['finance.read'], f.userId), { kind: 'granted', contactId: person.id, on: '2026-01-12', fromYear: 2025 }))).toBe('forbidden');
    expect(code(await recordNameConsent(f.deps, f.ctx, { kind: 'granted', contactId: 'NOPE', on: '2026-01-12', fromYear: 2025 }))).toBe('notFound');
    expect(code(await recordNameConsent(f.deps, f.ctx, { kind: 'granted', contactId: person.id, on: '2026-01-12', fromYear: 2025, documentId: 'NOPE' }))).toBe('notFound');
  });

  it('nennt die Nummer des verknüpften Dokuments', async () => {
    const { f, person } = await setup();
    const documentId = insertDocument(f, { subject: 'Einwilligung', typeKey: 'letter' });
    const res = unwrap(await recordNameConsent(f.deps, f.ctx, { kind: 'granted', contactId: person.id, on: '2026-01-12', fromYear: 2025, documentId }));
    expect(res.history[0]).toMatchObject({ documentId, documentNumber: expect.stringMatching(/^DOC-2026-/) });
  });

  it('protokolliert Jahr bzw. nichts, nie den Kontakt', async () => {
    const { f, person } = await setup();
    unwrap(await recordNameConsent(f.deps, f.ctx, { kind: 'granted', contactId: person.id, on: '2026-01-12', fromYear: 2025 }));
    const grant = auditEntry(f.deps, 'finance.nameConsent.grant');
    expect(JSON.parse(grant.params!)).toEqual({ fromYear: 2025 });
    expect(grant.entityType).toBe('financeNameConsent');
    expect(JSON.stringify(grant)).not.toContain(person.id);
    unwrap(await recordNameConsent(f.deps, f.ctx, { kind: 'revoked', contactId: person.id, on: '2026-05-01' }));
    const revoke = auditEntry(f.deps, 'finance.nameConsent.revoke');
    expect(JSON.stringify(revoke)).not.toContain(person.id);
  });

  it('ruft nach dem Widerruf die eingetragenen Haken mit dem Kontakt', async () => {
    const { f, person } = await setup();
    registerNameConsentRevokedHook(hook);
    unwrap(await recordNameConsent(f.deps, f.ctx, { kind: 'granted', contactId: person.id, on: '2026-01-12', fromYear: 2025 }));
    expect(seen).toEqual([]);
    unwrap(await recordNameConsent(f.deps, f.ctx, { kind: 'revoked', contactId: person.id, on: '2026-05-01' }));
    expect(seen).toEqual([person.id]);
  });

  it('geht mit dem Kontakt, wenn dieser gelöscht wird — protokolliert', async () => {
    const { f, person } = await setup();
    unwrap(await recordNameConsent(f.deps, f.ctx, { kind: 'granted', contactId: person.id, on: '2026-01-12', fromYear: 2025 }));
    f.deps.db.transaction((tx) => {
      tx.delete(contacts).where(eq(contacts.id, person.id)).run();
      financeRecordDeleted(tx, f.deps, f.ctx, 'contact', person.id);
    });
    expect(nameConsentHistoryInternal(f.deps.db, person.id)).toEqual([]);
    expect(auditEntry(f.deps, 'finance.nameConsent.delete').entityType).toBe('financeNameConsent');
  });

  it('steht im Lesedienst der Finanzangaben zum Kontakt mit der Kontaktart', async () => {
    const { f, person } = await setup();
    expect(unwrap(await getContactTaxDetails(f.deps, f.ctx, { contactId: person.id }))).toBeNull();
    unwrap(await recordNameConsent(f.deps, f.ctx, { kind: 'granted', contactId: person.id, on: '2026-01-12', fromYear: 2025 }));
    expect(unwrap(await getContactTaxDetails(f.deps, f.ctx, { contactId: person.id }))).toMatchObject({ contactId: person.id, contactKind: 'person', legalEntity: null, nameConsents: [{ kind: 'granted', fromYear: 2025 }] });
  });
});
