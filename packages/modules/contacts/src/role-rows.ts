import { newId, recordAudit, todayIn, type CallContext, type DbOrTx, type Deps } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { contactRoles } from './schema';

/**
 * Rollenzeilen für Module, die Rollen aus eigenen Vorgängen setzen (Spec Gremien § 3.4: eine Amtsinhaberschaft merkt
 * sich die ID ihrer Zeile). Anders als `startManagedRoleInternal` mit Notiz und Rückgabe der Zeilen-ID, und das Ende
 * trifft genau eine Zeile statt der jüngsten der Rolle — zwei Vorstandsämter nacheinander bei derselben Person haben je
 * eine Zeile `board-member`.
 *
 * Nur aus Diensten anderer Module in deren Transaktion; die Prüfung (Recht, `managedBy`) hat der Dienst gemacht.
 */
export function startRoleRowInternal(
  tx: DbOrTx,
  deps: Deps,
  ctx: CallContext,
  input: { contactId: string; role: string; since: string; note: string | null; representsAssociation?: boolean },
): string {
  const id = newId();
  const representsAssociation = input.representsAssociation ?? false;
  tx.insert(contactRoles).values({ id, contactId: input.contactId, role: input.role, since: input.since, until: null, note: input.note, representsAssociation }).run();
  const after = { role: input.role, since: input.since, ...(representsAssociation ? { representsAssociation } : {}) };
  recordAudit(tx, deps, ctx, { action: 'contacts.addRole', entityType: 'contact', entityId: input.contactId, after, params: { role: input.role } });
  return id;
}

/**
 * Setzt das Ende genau dieser Zeile; `until: null` öffnet sie wieder und wird protokolliert wie ein Beginn. Fehlt die
 * Zeile, ist das ein Programmfehler des aufrufenden Moduls.
 */
export function endRoleRowInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, input: { rowId: string; until: string | null }): void {
  const row = tx.select().from(contactRoles).where(eq(contactRoles.id, input.rowId)).get();
  if (!row) throw new Error(`role row ${input.rowId} missing`);
  tx.update(contactRoles).set({ until: input.until }).where(eq(contactRoles.id, row.id)).run();
  const entry = { entityType: 'contact', entityId: row.contactId, before: { role: row.role, until: row.until }, after: { role: row.role, until: input.until }, params: { role: row.role } };
  if (input.until === null) recordAudit(tx, deps, ctx, { action: 'contacts.addRole', ...entry });
  else recordAudit(tx, deps, ctx, { action: 'contacts.endRole', ...entry });
}

/**
 * Schaltet „vertritt nach § 26 BGB“ an einer **laufenden** Zeile (Ende leer oder nicht vor heute) um — das führende Modul
 * folgt so einer geänderten Vertretungsregel (Gremien: Amt wird vertretend oder nicht). Eine beendete Zeile ist
 * Geschichte und bleibt; sie hier zu treffen ist ein Programmfehler des Aufrufers. Protokolliert wie `updateContactRole`.
 */
export function setRoleRowRepresentationInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, input: { rowId: string; representsAssociation: boolean }): void {
  const row = tx.select().from(contactRoles).where(eq(contactRoles.id, input.rowId)).get();
  if (!row) throw new Error(`role row ${input.rowId} missing`);
  if (row.until !== null && row.until < todayIn(deps)) throw new Error(`role row ${input.rowId} has ended`);
  if (row.representsAssociation === input.representsAssociation) return;
  tx.update(contactRoles).set({ representsAssociation: input.representsAssociation }).where(eq(contactRoles.id, row.id)).run();
  recordAudit(tx, deps, ctx, {
    action: 'contacts.updateRole',
    entityType: 'contact',
    entityId: row.contactId,
    before: { role: row.role, representsAssociation: row.representsAssociation },
    after: { role: row.role, representsAssociation: input.representsAssociation, changedFields: ['representsAssociation'] },
    params: { role: row.role, representsAssociation: input.representsAssociation },
  });
}
