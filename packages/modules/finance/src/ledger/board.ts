import { readSetting, type DbOrTx, type Deps, type Failure } from '@kompass/core';
import { contactRoles, contacts, displayName } from '@kompass/module-contacts';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { financeConflict } from '../errors';
import { financeCategories } from '../schema';

/**
 * Befund T: Kompass erkennt Vorstandsmitglieder nur an der Kontaktrolle
 * `board-member` — das Amt, nicht die Nutzerrolle. Ob überhaupt ein Kontakt
 * die Rolle in einem Zeitraum trägt (`from`–`to`, ISO-Daten, beide
 * einschließlich). Ohne sie bleiben die Zahlungen an Vorstandsmitglieder
 * stumm leer; die Einrichtung und die Personenübersicht sagen es deshalb.
 * Keine Ableitung aus Nutzerrollen oder Finanzrechten (bewusst).
 */
export function boardMembersMaintainedInternal(db: DbOrTx, from: string, to: string): boolean {
  return !!db
    .select({ id: contactRoles.id })
    .from(contactRoles)
    .where(and(eq(contactRoles.role, 'board-member'), sql`${contactRoles.since} <= ${to}`, sql`(${contactRoles.until} is null or ${contactRoles.until} >= ${from})`))
    .limit(1)
    .get();
}

/**
 * Befund AH: eine Zeile mit Pauschalen-Art (`allowanceKind` ≠ `none`) an einen
 * Kontakt, der am Buchungstag die Rolle „Vorstand“ trägt, ohne am Buchungstag
 * gültige Grundlage der Vorstandsvergütung (Befund AK: „gilt ab“). Kein Verbot
 * — die Folge ist gemeinnützigkeitsrechtlich, die Entscheidung bleibt beim
 * Menschen —, aber ohne Begründung (`reason`) wird weder gespeichert noch
 * festgeschrieben. Ergebnis: der Konflikt oder `null`.
 */
export function boardAllowanceProblemInternal(
  db: DbOrTx,
  deps: Deps,
  entry: { entryDate: string; reason: string | null | undefined; lines: readonly { categoryId: string; amountCents: number; contactId?: string | null }[] },
): Failure | null {
  if (entry.reason?.trim()) return null;
  const validFrom = readSetting<boolean>(deps, 'finance.boardRemunerationAllowed') ? readSetting<string | null>(deps, 'finance.boardRemunerationValidFrom') : null;
  if (validFrom && validFrom <= entry.entryDate) return null;
  const candidates = entry.lines.filter((l): l is { categoryId: string; amountCents: number; contactId: string } => !!l.contactId && l.amountCents !== 0 && l.categoryId !== '');
  if (candidates.length === 0) return null;
  const allowanceCategories = new Set(
    db.select({ id: financeCategories.id }).from(financeCategories)
      .where(and(inArray(financeCategories.id, [...new Set(candidates.map((l) => l.categoryId))]), ne(financeCategories.allowanceKind, 'none'))).all()
      .map((c) => c.id),
  );
  for (const line of candidates) {
    if (!allowanceCategories.has(line.categoryId)) continue;
    const board = db.select({ id: contactRoles.id }).from(contactRoles)
      .where(and(eq(contactRoles.contactId, line.contactId), eq(contactRoles.role, 'board-member'), sql`${contactRoles.since} <= ${entry.entryDate}`, sql`(${contactRoles.until} is null or ${contactRoles.until} >= ${entry.entryDate})`))
      .limit(1).get();
    if (!board) continue;
    const contact = db.select().from(contacts).where(eq(contacts.id, line.contactId)).get();
    return financeConflict('boardAllowanceNeedsReason', { contact: contact ? displayName(contact) : '', date: entry.entryDate });
  }
  return null;
}
