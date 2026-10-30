import { ok, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { contactRoles } from '@kompass/module-contacts';
import { asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { contactNameInternal } from './minutes/compose';
import { governanceOffices, governanceTerms } from './schema';
import { rolesForFunction } from './term-roles';

export interface AdoptableRoleRow {
  rowId: string;
  contactId: string;
  name: string;
  role: string;
  note: string | null;
  since: string;
  until: string | null;
  /** Ämter, deren Funktion die Rolle mit sich bringt. */
  offices: string[];
}
export const adoptableRoleRowsSchema = z.object({});
const ADOPTABLE_ROLES = ['board-member', 'treasurer', 'auditor'] as const;

/**
 * G-29 (Spec § 3.4): Wie viele Rollenzeilen von Vorstand, Kasse und Kassenprüfung laufen am Tag, ohne dass eine
 * Inhaberschaft sie trägt — dort laufen Rolle und Amt auseinander, bis G7 die Rollen führt.
 */
export function divergingRoleRowsInternal(db: DbOrTx, day: string): number {
  const adopted = new Set(db.select({ ids: governanceTerms.roleRowIds }).from(governanceTerms).all().flatMap((t) => t.ids));
  return db
    .select()
    .from(contactRoles)
    .where(inArray(contactRoles.role, [...ADOPTABLE_ROLES]))
    .all()
    .filter((r) => !adopted.has(r.id) && r.since <= day && (r.until === null || r.until >= day)).length;
}

/** Trägt eine Amtszeit diese Rollenzeile? Nur dann führt Gremien sie (V-1); sonst bleibt sie in Kontakten beendbar. */
export function termOwnsRoleRowInternal(db: DbOrTx, rowId: string): boolean {
  return db.select({ ids: governanceTerms.roleRowIds }).from(governanceTerms).all().some((t) => t.ids.includes(rowId));
}

/** Rollenzeilen von vor Kompass, die noch keine Inhaberschaft trägt (Spec § 3.4) — Vorlage für `adoptRoleRows`. */
export async function listAdoptableRoleRows(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AdoptableRoleRow[]>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, adoptableRoleRowsSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const db = deps.db;
  const adopted = new Set(db.select({ ids: governanceTerms.roleRowIds }).from(governanceTerms).all().flatMap((t) => t.ids));
  const offices = db.select().from(governanceOffices).where(eq(governanceOffices.active, true)).orderBy(asc(governanceOffices.sortOrder), asc(governanceOffices.id)).all();
  const rows = db.select().from(contactRoles).where(inArray(contactRoles.role, [...ADOPTABLE_ROLES])).orderBy(asc(contactRoles.since), asc(contactRoles.id)).all();
  return ok(
    rows
      .filter((r) => !adopted.has(r.id))
      .map((r) => ({
        rowId: r.id,
        contactId: r.contactId,
        name: contactNameInternal(db, r.contactId) ?? '',
        role: r.role,
        note: r.note,
        since: r.since,
        until: r.until,
        offices: offices.filter((o) => rolesForFunction(o.function).includes(r.role)).map((o) => o.id),
      })),
  );
}
