import { localizedConflict, newId, recordAudit, type CallContext, type ContactRoleDefinition, type DbOrTx, type Deps, type Failure } from '@kompass/core';
import { and, desc, eq } from 'drizzle-orm';
import { contactRoles } from './schema';

/**
 * Eine Rolle, die ein Modul führt (`ContactRoleDefinition.managedBy`), setzt und beendet nur dieses Modul — von Hand
 * lehnen `addContactRole` und `endContactRole` sie ab und nennen das Modul (über `moduleKeys`, die Meldung schreibt
 * daraus den Namen).
 */
export function managedRoleRefusal(definition: ContactRoleDefinition): Failure | null {
  if (definition.managedBy === undefined) return null;
  return localizedConflict('roleManagedByModule', 'errors.roleManagedByModule', { moduleKeys: definition.managedBy });
}

/**
 * Beginnt eine geführte Rolle — nur aus einem Dienst des führenden Moduls, in dessen Transaktion. Keine Rechteprüfung:
 * Die hat der Dienst des Moduls gemacht. Protokolliert wie `addContactRole`.
 */
export function startManagedRoleInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, input: { contactId: string; role: string; since: string }): void {
  tx.insert(contactRoles).values({ id: newId(), contactId: input.contactId, role: input.role, since: input.since, until: null, note: null }).run();
  recordAudit(tx, deps, ctx, { action: 'contacts.addRole', entityType: 'contact', entityId: input.contactId, after: { role: input.role, since: input.since }, params: { role: input.role } });
}

/**
 * Setzt das Ende der jüngsten Zeile dieser Rolle am Kontakt (das Ende einer Mitgliedschaft steht oft in der Zukunft
 * und kann sich noch ändern). `until: null` öffnet sie wieder — „Ende zurücknehmen“; protokolliert wie ein Beginn,
 * weil die Rolle danach wieder läuft. Fehlt die Zeile, ist das ein Programmfehler des Moduls.
 */
export function endManagedRoleInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, input: { contactId: string; role: string; until: string | null }): void {
  const row = tx
    .select()
    .from(contactRoles)
    .where(and(eq(contactRoles.contactId, input.contactId), eq(contactRoles.role, input.role)))
    .orderBy(desc(contactRoles.since), desc(contactRoles.id))
    .get();
  if (!row) throw new Error(`managed role ${input.role} missing at contact ${input.contactId}`);
  tx.update(contactRoles).set({ until: input.until }).where(eq(contactRoles.id, row.id)).run();
  const entry = { entityType: 'contact', entityId: input.contactId, before: { role: row.role, until: row.until }, after: { role: row.role, until: input.until }, params: { role: row.role } };
  if (input.until === null) recordAudit(tx, deps, ctx, { action: 'contacts.addRole', ...entry });
  else recordAudit(tx, deps, ctx, { action: 'contacts.endRole', ...entry });
}
