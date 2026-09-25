import { newId, schema, unwrap, type CallContext } from '@kompass/core';
import { ctxWith, insertRole, insertUser, systemContext } from '@kompass/core/testing';
import { contactUserLinks, createContact } from '@kompass/module-contacts';
import { ledgerFixture, pdfBytes } from './helpers';

/**
 * Ausgangslage der Auslagen-Tests (F8a): der Ledger aus `ledgerFixture` und
 * zwei erfundene Helferinnen mit Nutzerkonto, verknüpftem Kontakt und nur dem
 * Recht `finance.expensesSubmit` — kein `finance.read`, kein Recht der Akte.
 * Dazu eine Verwalterin mit `users.manage` über eine Rolle, damit
 * `expenseNeedsContactLink` einen Namen nennen kann.
 */
export async function expenseFixture() {
  const f = await ledgerFixture();
  const manage: CallContext = { ...systemContext(), permissions: new Set(['contacts.manage']) };

  const helper = async (first: string, last: string, email: string) => {
    const userId = insertUser(f.deps, { name: `${first} ${last}`, email });
    const contact = unwrap(await createContact(f.deps, manage, { kind: 'person', firstName: first, lastName: last }));
    f.deps.db.insert(contactUserLinks).values({ id: newId(), userId, contactId: contact.id, linkedAt: '2026-01-01T00:00:00.000Z', linkedByUserId: userId, unlinkedAt: null, unlinkedByUserId: null }).run();
    return { userId, contactId: contact.id, ctx: ctxWith(['finance.expensesSubmit'], userId) };
  };

  const hanna = await helper('Hanna', 'Helferin', 'hanna@example.org');
  const otto = await helper('Otto', 'Oftfahrer', 'otto@example.org');

  const adminRole = insertRole(f.deps, { name: 'Verwaltung' });
  f.deps.db.insert(schema.rolePermissions).values({ roleId: adminRole, permissionKey: 'users.manage' }).run();
  const adminId = insertUser(f.deps, { name: 'Vera Verwalterin', email: 'vera@example.org' });
  f.deps.db.insert(schema.userRoles).values({ userId: adminId, roleId: adminRole }).run();

  /** Ein Nutzer ohne verknüpften Kontakt — nur `finance.expensesSubmit`. */
  const unlinkedId = insertUser(f.deps, { name: 'Ulla Unverknüpft', email: 'ulla@example.org' });
  const unlinked = ctxWith(['finance.expensesSubmit'], unlinkedId);

  return { ...f, hanna, otto, unlinked, pdf: pdfBytes };
}

export type ExpenseFixture = Awaited<ReturnType<typeof expenseFixture>>;

/** Ein JPEG-Anfang — das Foto, das kein PDF ist. */
export const jpegBytes = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
