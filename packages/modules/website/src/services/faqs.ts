import { isoNow, localizedText, newId, notFound, ok, recordAudit, requirePermission, validate, type CallContext, type Deps, type Result } from '@kompass/core';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { websiteFaqs } from '../schema';
import { nextSortOrder } from './common';

export type FaqRecord = typeof websiteFaqs.$inferSelect;

const fields = {
  category: localizedText({ required: true, max: 60 }),
  question: localizedText({ required: true, max: 200 }),
  answer: localizedText({ required: true, max: 2000 }),
};
const createSchema = z.object(fields);
const updateSchema = z.object({
  id: z.string().min(1),
  category: fields.category.optional(),
  question: fields.question.optional(),
  answer: fields.answer.optional(),
});

const load = (db: Deps['db'], id: string) => db.select().from(websiteFaqs).where(eq(websiteFaqs.id, id)).get() ?? null;

export async function createFaq(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FaqRecord>> {
  const denied = requirePermission(ctx, 'website.manage');
  if (denied) return denied;
  const parsed = validate(createSchema, input);
  if (!parsed.ok) return parsed;
  return deps.db.transaction((tx) => {
    const id = newId();
    const now = isoNow(deps.clock);
    tx.insert(websiteFaqs).values({
      id,
      ...parsed.value,
      sortOrder: nextSortOrder(tx, websiteFaqs, websiteFaqs.sortOrder),
      isPublished: false,
      createdAt: now,
      updatedAt: now,
    }).run();
    const record = load(tx as Deps['db'], id)!;
    recordAudit(tx, deps, ctx, { action: 'website.faqs.create', entityType: 'websiteFaq', entityId: id, after: record, summary: `FAQ angelegt` });
    return ok(record);
  });
}

export async function updateFaq(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FaqRecord>> {
  const denied = requirePermission(ctx, 'website.manage');
  if (denied) return denied;
  const parsed = validate(updateSchema, input);
  if (!parsed.ok) return parsed;
  const { id, ...changes } = parsed.value;
  const before = load(deps.db, id);
  if (!before) return notFound('websiteFaq', id);
  return deps.db.transaction((tx) => {
    tx.update(websiteFaqs).set({ ...changes, updatedAt: isoNow(deps.clock) }).where(eq(websiteFaqs.id, id)).run();
    const after = load(tx as Deps['db'], id)!;
    recordAudit(tx, deps, ctx, { action: 'website.faqs.update', entityType: 'websiteFaq', entityId: id, before, after, summary: `FAQ geändert` });
    return ok(after);
  });
}

export async function setFaqPublished(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FaqRecord>> {
  const denied = requirePermission(ctx, 'website.manage');
  if (denied) return denied;
  const parsed = validate(z.object({ id: z.string().min(1), isPublished: z.boolean() }), input);
  if (!parsed.ok) return parsed;
  const before = load(deps.db, parsed.value.id);
  if (!before) return notFound('websiteFaq', parsed.value.id);
  return deps.db.transaction((tx) => {
    tx.update(websiteFaqs).set({ isPublished: parsed.value.isPublished, updatedAt: isoNow(deps.clock) }).where(eq(websiteFaqs.id, before.id)).run();
    const after = load(tx as Deps['db'], before.id)!;
    recordAudit(tx, deps, ctx, {
      action: parsed.value.isPublished ? 'website.faqs.publish' : 'website.faqs.unpublish',
      entityType: 'websiteFaq',
      entityId: before.id,
      before: { isPublished: before.isPublished },
      after: { isPublished: after.isPublished },
      summary: `FAQ ${after.isPublished ? 'veröffentlicht' : 'zurückgezogen'}`,
    });
    return ok(after);
  });
}

export async function reorderFaqs(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<void>> {
  const denied = requirePermission(ctx, 'website.manage');
  if (denied) return denied;
  const parsed = validate(z.object({ ids: z.array(z.string().min(1)).min(1) }), input);
  if (!parsed.ok) return parsed;
  return deps.db.transaction((tx) => {
    parsed.value.ids.forEach((id, index) => tx.update(websiteFaqs).set({ sortOrder: index + 1 }).where(eq(websiteFaqs.id, id)).run());
    recordAudit(tx, deps, ctx, { action: 'website.faqs.reorder', entityType: 'websiteFaq', entityId: null, after: parsed.value.ids, summary: 'FAQ-Reihenfolge geändert' });
    return ok(undefined);
  });
}

export async function listFaqs(deps: Deps, ctx: CallContext): Promise<Result<FaqRecord[]>> {
  const denied = requirePermission(ctx, 'website.view');
  if (denied) return denied;
  return ok(deps.db.select().from(websiteFaqs).orderBy(asc(websiteFaqs.sortOrder)).all());
}

export async function getFaq(deps: Deps, ctx: CallContext, id: string): Promise<Result<FaqRecord>> {
  const denied = requirePermission(ctx, 'website.view');
  if (denied) return denied;
  const record = load(deps.db, id);
  return record ? ok(record) : notFound('websiteFaq', id);
}
