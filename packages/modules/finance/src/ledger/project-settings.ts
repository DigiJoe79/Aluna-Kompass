import { isoNow, notFound, ok, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { projects } from '@kompass/module-projects';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financePurposes, financeProjectSettings, type FinanceProjectSettingsRow } from '../schema';
import { requireFinanceRead } from './access';
import { projectBalances } from './queries';

export type ProjectFinanceSettings = FinanceProjectSettingsRow;

const DEFAULTS: Omit<ProjectFinanceSettings, 'projectId'> = { targetCents: null, defaultPurposeId: null, abroad: false, publishDonationStatus: false, updatedAt: '' };

/** Die Vorgaben, wenn es (noch) keine Zeile gibt — ohne Rechteprüfung, für F2c und ihre Verbraucher (u. a. `entries.ts`). */
export function projectFinanceInternal(db: DbOrTx, projectId: string): ProjectFinanceSettings {
  const row = db.select().from(financeProjectSettings).where(eq(financeProjectSettings.projectId, projectId)).get();
  return row ?? { projectId, ...DEFAULTS };
}

function projectExists(db: DbOrTx, id: string): boolean {
  return !!db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).get();
}
function purposeExists(db: DbOrTx, id: string): boolean {
  return !!db.select({ id: financePurposes.id }).from(financePurposes).where(eq(financePurposes.id, id)).get();
}

const getSchema = z.object({ projectId: z.string().min(1) });

/** Stufe `overview`, ohne Namen — nur IDs und Schalter. */
export async function getProjectFinance(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ settings: ProjectFinanceSettings; result: { incomeCents: number; expenseCents: number; resultCents: number } }>> {
  const denied = requireFinanceRead(ctx, 'overview');
  if (denied) return denied;
  const parsed = validate(deps, getSchema, input);
  if (!parsed.ok) return parsed;
  const settings = projectFinanceInternal(deps.db, parsed.value.projectId);
  const row = projectBalances(deps.db, {}).find((p) => p.projectId === parsed.value.projectId);
  const result = row ? { incomeCents: row.incomeCents, expenseCents: row.expenseCents, resultCents: row.resultCents } : { incomeCents: 0, expenseCents: 0, resultCents: 0 };
  return ok({ settings, result });
}

const setSchema = z.object({
  projectId: z.string().min(1),
  targetCents: z.number().int().nullable().optional(),
  defaultPurposeId: z.string().min(1).nullable().optional(),
  abroad: z.boolean().optional(),
  publishDonationStatus: z.boolean().optional(),
});

/** `finance.setup`. */
export async function setProjectFinance(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ProjectFinanceSettings>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, setSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (!projectExists(deps.db, v.projectId)) return notFound('project', v.projectId);
  if (v.defaultPurposeId && !purposeExists(deps.db, v.defaultPurposeId)) return notFound('financePurpose', v.defaultPurposeId);

  const before = projectFinanceInternal(deps.db, v.projectId);
  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    const after: ProjectFinanceSettings = {
      projectId: v.projectId,
      targetCents: v.targetCents === undefined ? before.targetCents : v.targetCents,
      defaultPurposeId: v.defaultPurposeId === undefined ? before.defaultPurposeId : v.defaultPurposeId,
      abroad: v.abroad ?? before.abroad,
      publishDonationStatus: v.publishDonationStatus ?? before.publishDonationStatus,
      updatedAt: now,
    };
    tx.insert(financeProjectSettings)
      .values(after)
      .onConflictDoUpdate({ target: financeProjectSettings.projectId, set: after })
      .run();
    financeAudit(tx, deps, ctx, { action: 'finance.projectSettings.set', entity: 'financeProjectSettings', id: v.projectId, before, after, summary: `Finanzfelder von Projekt ${v.projectId} geändert` });
    return ok(after);
  });
}
