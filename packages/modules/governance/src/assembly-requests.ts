import { invalid, isoNow, newId, notFound, ok, recordAudit, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { countMembersAtInternal } from '@kompass/module-members';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { resolveRule } from './rules/resolve';
import { governanceAssemblyRequests, governanceMeetings, governanceOrgans, type AssemblyRequestRow } from './schema';
import { statuteRulesOnInternal } from './statutes';

const id = z.string().min(1);

/** `required`: der Teil der Mitglieder am Eingangstag nach dem Regelwerk (Rückfall 1/10, § 37 Abs. 1 BGB). */
export type AssemblyRequestView = AssemblyRequestRow & { required: number; memberCount: number; reached: boolean; meetingId: string | null };

export const assemblyRequestSaveSchema = z.object({
  id: id.optional(),
  organId: id,
  receivedOn: z.iso.date(),
  supporters: z.number().int().min(0).max(100000),
  purpose: z.string().trim().min(1).max(5000),
  documentId: id.nullable().optional(),
});
export const assemblyRequestListSchema = z.object({});

function viewOf(db: DbOrTx, deps: Deps, row: AssemblyRequestRow): AssemblyRequestView {
  const fraction = resolveRule(statuteRulesOnInternal(db, row.receivedOn).rules, row.organId, 'minorityRequest').value ?? { num: 1, den: 10 };
  const memberCount = countMembersAtInternal(deps, row.receivedOn).total;
  const required = Math.ceil((fraction.num * memberCount) / fraction.den);
  const meeting = db.select({ id: governanceMeetings.id }).from(governanceMeetings).where(eq(governanceMeetings.assemblyRequestId, row.id)).get();
  return { ...row, required, memberCount, reached: row.supporters >= required, meetingId: meeting?.id ?? null };
}

/** Erfasst ein Verlangen (Anzahl, Zweck, Eingang) oder ändert es; Kompass zeigt, ob das Quorum erreicht ist. */
export async function saveAssemblyRequest(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AssemblyRequestView>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, assemblyRequestSaveSchema, input);
  if (!parsed.ok) return parsed;
  const { id: requestId, ...v } = parsed.value;
  const organ = deps.db.select().from(governanceOrgans).where(eq(governanceOrgans.id, v.organId)).get();
  if (!organ) return notFound('governanceOrgan', v.organId);
  if (organ.kind !== 'assembly') return invalid([{ path: 'organId', message: 'onlyAssembly' }]);
  const before = requestId ? deps.db.select().from(governanceAssemblyRequests).where(eq(governanceAssemblyRequests.id, requestId)).get() : undefined;
  if (requestId && !before) return notFound('governanceAssemblyRequest', requestId);
  const values = { organId: v.organId, receivedOn: v.receivedOn, supporters: v.supporters, purpose: v.purpose, documentId: v.documentId ?? null };
  const now = isoNow(deps.clock);
  return deps.db.transaction((tx: DbOrTx) => {
    const rowId = before?.id ?? newId();
    if (before) tx.update(governanceAssemblyRequests).set({ ...values, updatedAt: now }).where(eq(governanceAssemblyRequests.id, rowId)).run();
    else tx.insert(governanceAssemblyRequests).values({ id: rowId, ...values, createdAt: now, updatedAt: now }).run();
    const view = viewOf(tx, deps, tx.select().from(governanceAssemblyRequests).where(eq(governanceAssemblyRequests.id, rowId)).get()!);
    recordAudit(tx, deps, ctx, {
      action: 'governance.assemblyRequest.save',
      entityType: 'governanceAssemblyRequest',
      entityId: rowId,
      ...(before ? { before: { receivedOn: before.receivedOn, supporters: before.supporters } } : {}),
      after: { receivedOn: view.receivedOn, supporters: view.supporters, required: view.required },
      params: { receivedOn: view.receivedOn, supporters: view.supporters, reached: view.reached },
    });
    return ok(view);
  });
}

/** Die Verlangen nach Eingang, mit Quorum und der Sitzung, die daraus entstand. */
export async function listAssemblyRequests(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AssemblyRequestView[]>> {
  const denied = requirePermission(ctx, 'governance.read');
  if (denied) return denied;
  const parsed = validate(deps, assemblyRequestListSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const rows = deps.db.select().from(governanceAssemblyRequests).orderBy(asc(governanceAssemblyRequests.receivedOn), asc(governanceAssemblyRequests.id)).all();
  return ok(rows.map((r) => viewOf(deps.db, deps, r)));
}
