import { isoNow, notFound, ok, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { and, eq, inArray, lt } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict } from '../errors';
import { financeAllocationLines, financeCategories, financeEntries, financeNotReturnMarks } from '../schema';
import { CERTIFIABLE_INCOME_KINDS } from './codes';

export interface NotReturnMarkView {
  note: string;
  byUserId: string;
  at: string;
}

/** Die gültige Kennzeichnung „ist keine Rückgabe“ einer Buchung — `null`, wenn keine gesetzt oder sie aufgehoben ist. */
export function notReturnMarkInternal(db: DbOrTx, entryId: string): NotReturnMarkView | null {
  const row = db.select().from(financeNotReturnMarks).where(eq(financeNotReturnMarks.entryId, entryId)).get();
  if (!row || row.revokedAt !== null) return null;
  return { note: row.note, byUserId: row.byUserId, at: row.at };
}

export const markNotReturnSchema = z
  .object({ entryId: z.string().min(1), notReturn: z.boolean(), note: z.string().trim().max(500).optional() })
  .superRefine((v, ctx) => {
    if (v.notReturn && !v.note) ctx.addIssue({ code: 'custom', path: ['note'], message: 'noteRequired' });
  });

/**
 * `finance.entriesFinalize` (AC): Eine festgeschriebene Auszahlung an eine
 * Person, die auch gespendet hat, ist keine Rückgabe (Erstattung, Honorar) —
 * dann sperrt sie deren Bestätigung nicht länger als möglicher Rückläufer
 * (`possibleReturnsWithoutOriginInternal`). Mit Pflichtbegründung am
 * Datensatz, nie im Protokoll; `notReturn: false` hebt die Kennzeichnung auf.
 */
export async function markNotReturn(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ entryId: string; notReturn: boolean }>> {
  const denied = requirePermission(ctx, 'finance.entriesFinalize');
  if (denied) return denied;
  const parsed = validate(deps, markNotReturnSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const entry = deps.db.select().from(financeEntries).where(eq(financeEntries.id, v.entryId)).get();
  if (!entry) return notFound('financeEntry', v.entryId);
  if (entry.status !== 'final') return financeConflict('entryNotFinal');
  // N2: Eine Auszahlung auf einer bestätigungsfähigen Kategorie ist eine Rückgabe — sie gehört mit der Spende verknüpft, nicht weggekennzeichnet.
  if (v.notReturn && certifiableOutflowInternal(deps.db, entry.id)) return financeConflict('notReturnOnCertifiableCategory');

  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    const by = ctx.userId ?? 'system';
    const before = notReturnMarkInternal(tx, entry.id) !== null;
    if (v.notReturn) {
      tx.insert(financeNotReturnMarks)
        .values({ entryId: entry.id, note: v.note!, byUserId: by, at: now, revokedAt: null, revokedByUserId: null })
        .onConflictDoUpdate({ target: financeNotReturnMarks.entryId, set: { note: v.note!, byUserId: by, at: now, revokedAt: null, revokedByUserId: null } })
        .run();
    } else {
      tx.update(financeNotReturnMarks).set({ revokedAt: now, revokedByUserId: by }).where(eq(financeNotReturnMarks.entryId, entry.id)).run();
    }
    financeAudit(tx, deps, ctx, {
      action: 'finance.entry.notReturn', entity: 'financeNotReturnMark', id: entry.id,
      before: { entryId: entry.id, notReturn: before }, after: { entryId: entry.id, notReturn: v.notReturn },
      params: { number: entry.number ?? null, notReturn: v.notReturn },
    });
    return ok({ entryId: entry.id, notReturn: v.notReturn });
  });
}

/** N2: Trägt die Buchung eine negative Zuordnungszeile auf einer bestätigungsfähigen Kategorie? */
export function certifiableOutflowInternal(db: DbOrTx, entryId: string, opts: { withoutOrigin?: boolean } = {}): boolean {
  const rows = db
    .select({ originLineId: financeAllocationLines.originLineId })
    .from(financeAllocationLines)
    .innerJoin(financeCategories, eq(financeCategories.id, financeAllocationLines.categoryId))
    .where(and(eq(financeAllocationLines.entryId, entryId), lt(financeAllocationLines.amountCents, 0), inArray(financeCategories.incomeKind, [...CERTIFIABLE_INCOME_KINDS])))
    .all();
  return opts.withoutOrigin ? rows.some((r) => r.originLineId === null) : rows.length > 0;
}
