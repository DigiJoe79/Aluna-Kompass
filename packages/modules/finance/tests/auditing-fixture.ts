import { newId, roleIdByOrigin, schema, unwrap, type CallContext } from '@kompass/core';
import { ctxWith, insertUser, systemContext } from '@kompass/core/testing';
import { contactUserLinks, createContact } from '@kompass/module-contacts';
import { saveAuditor } from '../src/auditing/auditors';
import { ledgerFixture } from './helpers';

/** Was die Rolle Kassenprüfer neuer Installationen trägt (Plan D1a, Zugang). */
export const AUDITOR_PERMISSIONS = ['finance.read', 'finance.overview', 'finance.audit', 'documents.export'] as const;

/**
 * Kassenprüfung: Jahre 2025 (abgeschlossen, wenn `close`) und 2026, eine Prüferin in Kompass (Nutzer, verknüpft, Rolle
 * Kassenprüfer) und ein Prüfer auf Papier — beide erfunden. `f.ctx` ist die Schatzmeisterin mit allen Finanzrechten.
 */
export async function auditFixture(opts: { close?: boolean } = {}) {
  const f = await ledgerFixture({ years: ['2025', '2026'] });
  const y2025 = f.years['2025']!.id;
  const y2026 = f.years['2026']!.id;
  const contactCtx: CallContext = { ...systemContext(), permissions: new Set(['contacts.manage']) };
  const person = async (lastName: string, firstName = 'Testa') => unwrap(await createContact(f.deps, contactCtx, { kind: 'person', firstName, lastName }));

  /** Ein Nutzer, verknüpft mit einem neuen Kontakt; mit `role` hat er die Rolle Kassenprüfer. */
  const linkedUser = async (lastName: string, permissions: readonly string[] = AUDITOR_PERMISSIONS, role = true) => {
    const contact = await person(lastName);
    const userId = insertUser(f.deps, { name: `Testa ${lastName}`, email: `${lastName.toLowerCase()}@kompass.local` });
    f.deps.db.insert(contactUserLinks).values({ id: newId(), userId, contactId: contact.id, linkedAt: '2026-01-01T00:00:00.000Z', linkedByUserId: f.userId, unlinkedAt: null, unlinkedByUserId: null }).run();
    if (role) f.deps.db.insert(schema.userRoles).values({ userId, roleId: roleIdByOrigin(f.deps.db, 'finance:auditor')! }).run();
    return { contact, userId, ctx: ctxWith(permissions, userId) };
  };

  if (opts.close !== false) f.closeYear(y2025);
  const mira = await linkedUser('Prüferin');
  const paperContact = await person('Papierprüfer', 'Paul');
  const miraAuditor = unwrap(await saveAuditor(f.deps, f.ctx, { fiscalYearId: y2025, contactId: mira.contact.id, mode: 'kompass', confidential: true }));
  const paperAuditor = unwrap(await saveAuditor(f.deps, f.ctx, { fiscalYearId: y2025, contactId: paperContact.id, mode: 'paper', confidential: false }));
  return { f, y2025, y2026, person, linkedUser, mira, paperContact, miraAuditor, paperAuditor };
}
