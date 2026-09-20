import { dueUntil, holdsFor, retentionEnd, retentionMonths, type Deps, type DueItem, type RetentionHold } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { displayName } from './address';
import { contactRoleDefinitions } from './roles';
import { contactRoles, contacts } from './schema';

/**
 * Die Rollen eines Kontakts als Halter. Eine laufende Rolle (`until === null`)
 * hält bis auf Weiteres — ihr Ende steht noch nicht fest, also rechnet sie ab
 * heute. Eine beendete Rolle hält ab ihrem Ende.
 */
export function contactsRetentionHolds(deps: Deps, entityType: string, id: string): RetentionHold[] {
  if (entityType !== 'contact') return [];
  const definitions = contactRoleDefinitions(deps);
  const rows = deps.db.select().from(contactRoles).where(eq(contactRoles.contactId, id)).all();
  const holds = rows.flatMap((row): RetentionHold[] => {
    const definition = definitions.get(row.role);
    if (!definition || definition.retention === 'none') return [];
    if (definition.retention === 'permanent') return [{ label: `Rolle ${row.role} (dauerhaft)`, until: null, entity: 'contactRole', id: row.id }];
    const months = retentionMonths(deps, definition.retention);
    if (months === null) return [];
    const from = row.until ?? deps.clock.now().toISOString();
    return [{ label: `Rolle ${row.role}`, until: retentionEnd(from, months), entity: 'contactRole', id: row.id }];
  });

  // Rollen ohne eigene Frist halten nicht — aber ihr Kontakt darf deshalb nicht
  // ohne jeden Halter dastehen: Dann wäre „keine Frist nachgewiesen“, und er
  // würde nie fällig. Das ist der Spender, dessen Buchungen abgelaufen sind.
  // Grundfrist: `consent` ab dem Ende der letzten solchen Rolle, mindestens ab
  // dem Anlagejahr. Hält ein Modul länger, sticht sein Halter.
  const unheld = rows.filter((row) => definitions.get(row.role)?.retention === 'none');
  if (unheld.length > 0) {
    const months = retentionMonths(deps, 'consent');
    const contact = deps.db.select({ createdAt: contacts.createdAt }).from(contacts).where(eq(contacts.id, id)).get();
    if (months !== null && contact) {
      const from = [contact.createdAt, ...unheld.map((row) => row.until).filter((u): u is string => u !== null)].sort().at(-1)!;
      holds.push({ label: 'Grundfrist (Rollen ohne eigene Frist)', until: retentionEnd(from, months), entity: 'contact', id });
    }
  }
  return holds;
}

/** Kontakte, deren sämtliche Halter abgelaufen sind. */
export function contactsRetentionDue(deps: Deps): DueItem[] {
  const today = deps.clock.now().toISOString().slice(0, 10);
  const due: DueItem[] = [];
  for (const row of deps.db.select().from(contacts).all()) {
    const holds = holdsFor(deps, 'contact', row.id);
    if (holds.length === 0) continue; // ohne Halter ist nichts nachgewiesen — siehe `retentionUnknown`
    const until = dueUntil(holds);
    if (until !== null && until < today) due.push({ entity: 'contact', id: row.id, label: displayName(row), dueSince: until, href: `/contacts/${row.id}` });
  }
  return due;
}
