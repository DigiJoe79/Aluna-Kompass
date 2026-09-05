import { invalid, isoNow, localizedText, newId, notFound, ok, recordAudit, requirePermission, validate, type CallContext, type Deps, type Failure, type Result } from '@kompass/core';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { websiteTeam } from '../schema';
import { assetMime, nextSortOrder } from './common';

export type TeamMemberRecord = typeof websiteTeam.$inferSelect;

const fields = {
  name: z.string().trim().min(1).max(120),
  position: localizedText({ required: true, max: 120 }),
  photoAssetId: z.string().nullable().default(null),
  petPhotoAssetId: z.string().nullable().default(null),
};
const createSchema = z.object(fields);
const updateSchema = z.object({
  id: z.string().min(1),
  name: fields.name.optional(),
  position: fields.position.optional(),
  photoAssetId: fields.photoAssetId.optional(),
  petPhotoAssetId: fields.petPhotoAssetId.optional(),
});

const load = (db: Deps['db'], id: string) => db.select().from(websiteTeam).where(eq(websiteTeam.id, id)).get() ?? null;

function checkAsset(db: Deps['db'], id: string | null | undefined, path: string): Failure | null {
  if (id === null || id === undefined) return null;
  const mime = assetMime(db, id);
  if (!mime) return notFound('mediaAsset', id);
  if (!mime.startsWith('image/')) return invalid([{ path, message: 'notAnImage' }]);
  return null;
}

export async function createTeamMember(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<TeamMemberRecord>> {
  const denied = requirePermission(ctx, 'website.manage');
  if (denied) return denied;
  const parsed = validate(createSchema, input);
  if (!parsed.ok) return parsed;
  const errPhoto = checkAsset(deps.db, parsed.value.photoAssetId, 'photoAssetId');
  if (errPhoto) return errPhoto;
  const errPet = checkAsset(deps.db, parsed.value.petPhotoAssetId, 'petPhotoAssetId');
  if (errPet) return errPet;

  return deps.db.transaction((tx) => {
    const id = newId();
    const now = isoNow(deps.clock);
    tx.insert(websiteTeam).values({
      id,
      ...parsed.value,
      sortOrder: nextSortOrder(tx, websiteTeam, websiteTeam.sortOrder),
      isPublished: false,
      createdAt: now,
      updatedAt: now,
    }).run();
    const record = load(tx as Deps['db'], id)!;
    recordAudit(tx, deps, ctx, { action: 'website.team.create', entityType: 'websiteTeamMember', entityId: id, after: record, summary: `Teammitglied ${record.name} angelegt` });
    return ok(record);
  });
}

export async function updateTeamMember(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<TeamMemberRecord>> {
  const denied = requirePermission(ctx, 'website.manage');
  if (denied) return denied;
  const parsed = validate(updateSchema, input);
  if (!parsed.ok) return parsed;
  const { id, ...changes } = parsed.value;
  const before = load(deps.db, id);
  if (!before) return notFound('websiteTeamMember', id);
  if (changes.photoAssetId !== undefined) {
    const errPhoto = checkAsset(deps.db, changes.photoAssetId, 'photoAssetId');
    if (errPhoto) return errPhoto;
  }
  if (changes.petPhotoAssetId !== undefined) {
    const errPet = checkAsset(deps.db, changes.petPhotoAssetId, 'petPhotoAssetId');
    if (errPet) return errPet;
  }
  return deps.db.transaction((tx) => {
    tx.update(websiteTeam).set({ ...changes, updatedAt: isoNow(deps.clock) }).where(eq(websiteTeam.id, id)).run();
    const after = load(tx as Deps['db'], id)!;
    recordAudit(tx, deps, ctx, { action: 'website.team.update', entityType: 'websiteTeamMember', entityId: id, before, after, summary: `Teammitglied ${after.name} geändert` });
    return ok(after);
  });
}

export async function setTeamMemberPublished(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<TeamMemberRecord>> {
  const denied = requirePermission(ctx, 'website.manage');
  if (denied) return denied;
  const parsed = validate(z.object({ id: z.string().min(1), isPublished: z.boolean() }), input);
  if (!parsed.ok) return parsed;
  const before = load(deps.db, parsed.value.id);
  if (!before) return notFound('websiteTeamMember', parsed.value.id);
  return deps.db.transaction((tx) => {
    tx.update(websiteTeam).set({ isPublished: parsed.value.isPublished, updatedAt: isoNow(deps.clock) }).where(eq(websiteTeam.id, before.id)).run();
    const after = load(tx as Deps['db'], before.id)!;
    recordAudit(tx, deps, ctx, {
      action: parsed.value.isPublished ? 'website.team.publish' : 'website.team.unpublish',
      entityType: 'websiteTeamMember',
      entityId: before.id,
      before: { isPublished: before.isPublished },
      after: { isPublished: after.isPublished },
      summary: `Teammitglied ${after.name} ${after.isPublished ? 'veröffentlicht' : 'zurückgezogen'}`,
    });
    return ok(after);
  });
}

export async function reorderTeam(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<void>> {
  const denied = requirePermission(ctx, 'website.manage');
  if (denied) return denied;
  const parsed = validate(z.object({ ids: z.array(z.string().min(1)).min(1) }), input);
  if (!parsed.ok) return parsed;
  return deps.db.transaction((tx) => {
    parsed.value.ids.forEach((id, index) => tx.update(websiteTeam).set({ sortOrder: index + 1 }).where(eq(websiteTeam.id, id)).run());
    recordAudit(tx, deps, ctx, { action: 'website.team.reorder', entityType: 'websiteTeamMember', entityId: null, after: parsed.value.ids, summary: 'Teamreihenfolge geändert' });
    return ok(undefined);
  });
}

export async function listTeam(deps: Deps, ctx: CallContext): Promise<Result<TeamMemberRecord[]>> {
  const denied = requirePermission(ctx, 'website.view');
  if (denied) return denied;
  return ok(deps.db.select().from(websiteTeam).orderBy(asc(websiteTeam.sortOrder)).all());
}

export async function getTeamMember(deps: Deps, ctx: CallContext, id: string): Promise<Result<TeamMemberRecord>> {
  const denied = requirePermission(ctx, 'website.view');
  if (denied) return denied;
  const record = load(deps.db, id);
  return record ? ok(record) : notFound('websiteTeamMember', id);
}
