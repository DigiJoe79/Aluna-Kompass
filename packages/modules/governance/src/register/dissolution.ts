import { invalid, isoNow, notFound, ok, recordAudit, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { governanceConflict } from '../errors';
import { governanceRegisterFilings, type FilingDissolution } from '../schema';
import { filingOccasionsInternal, filingRowInternal, filingViewInternal, type FilingView } from './filings';

export * from './dissolution-rules';

const DAY = z.iso.date();
export const dissolutionSaveSchema = z.object({
  filingId: z.string().min(1),
  /** Mitteilung an das Finanzamt (§ 137 Abs. 1 AO). */
  taxOfficeNotifiedOn: DAY.nullable().optional(),
  /** Mitteilung an die Gemeinde (§ 137 Abs. 2 AO). */
  municipalityNotifiedOn: DAY.nullable().optional(),
  /** Bekanntmachung der Auflösung (§ 50 BGB) — Beginn des Sperrjahrs. */
  announcedOn: DAY.nullable().optional(),
});

/** Vermerkt Mitteilungen und Bekanntmachung zur Auflösung (Spec § 6); auch nach der Eintragung. Kompass teilt nichts mit. */
export async function saveDissolutionNotices(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FilingView>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, dissolutionSaveSchema, input);
  if (!parsed.ok) return parsed;
  const { filingId, ...changes } = parsed.value;
  const before = filingRowInternal(deps.db, filingId);
  if (!before) return notFound('governanceRegisterFiling', filingId);
  if (!filingOccasionsInternal(deps.db, filingId).some((o) => o.kind === 'dissolution')) return governanceConflict('filingNotDissolution');
  const fields = (Object.keys(changes) as (keyof typeof changes)[]).filter((k) => changes[k] !== undefined);
  if (fields.length === 0) return invalid([{ path: '', message: 'nothingChanged' }]);
  const current: FilingDissolution = before.dissolution ?? { taxOfficeNotifiedOn: null, municipalityNotifiedOn: null, announcedOn: null };
  const dissolution: FilingDissolution = { ...current, ...Object.fromEntries(fields.map((k) => [k, changes[k] ?? null])) };
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(governanceRegisterFilings).set({ dissolution, updatedAt: isoNow(deps.clock) }).where(eq(governanceRegisterFilings.id, filingId)).run();
    recordAudit(tx, deps, ctx, { action: 'governance.register.dissolution', entityType: 'governanceRegisterFiling', entityId: filingId, before: current, after: dissolution, params: { fields: fields.join(', ') } });
    return ok(filingViewInternal(tx, deps, filingRowInternal(tx, filingId)!));
  });
}
