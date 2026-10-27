import type { DbOrTx } from '@kompass/core';
import { contactRoles } from '@kompass/module-contacts';
import { and, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';

/** Der Kontakt mit der Rolle Schatzmeister an einem Tag — eine Quelle für Übergabe und Kassenprüfung (Designer Runde 7, 281). */
export function treasurerContactIdAtInternal(db: DbOrTx, day: string): string | null {
  const role = db.select({ contactId: contactRoles.contactId }).from(contactRoles).where(and(eq(contactRoles.role, 'treasurer'), lte(contactRoles.since, day), or(isNull(contactRoles.until), gte(contactRoles.until, day)))).orderBy(desc(contactRoles.since)).get();
  return role?.contactId ?? null;
}
