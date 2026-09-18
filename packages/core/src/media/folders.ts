import { asc, eq, like, sql } from 'drizzle-orm';
import { z } from 'zod';
import { recordAudit } from '../audit/log';
import { isoNow } from '../clock';
import type { CallContext } from '../context';
import { mediaAssets, mediaFolders } from '../db/schema';
import type { Deps } from '../deps';
import { requirePermission } from '../permissions/check';
import { conflict, invalid, notFound, ok, type Result } from '../result';

// Ein Ordnername ist eine Beschriftung, kein Slug: Groß-/Kleinschreibung und
// Leerzeichen sind erlaubt. Verboten sind nur `/` (Pfadtrenner), `\` und
// Steuerzeichen; Rand-Leerzeichen und die Segmente `.`/`..` fängt parseFolderPath.
export const FOLDER_SEGMENT = /^[^/\\\x00-\x1f]{1,60}$/;

/** Kanonische Ordnerform oder `null`, wenn ungültig. */
export function parseFolderPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/^\/+|\/+$/g, '');
  if (trimmed === '' || trimmed.length > 200) return null;
  const segments = trimmed.split('/');
  if (segments.length > 8) return null;
  for (const s of segments) {
    if (!FOLDER_SEGMENT.test(s) || s !== s.trim() || s === '.' || s === '..') return null;
  }
  return segments.join('/');
}

const parentOf = (path: string): string | null => {
  const i = path.lastIndexOf('/');
  return i === -1 ? null : path.slice(0, i);
};

export function folderExists(deps: Pick<Deps, 'db'>, path: string): boolean {
  return !!deps.db.select({ path: mediaFolders.path }).from(mediaFolders).where(eq(mediaFolders.path, path)).get();
}

export async function listMediaFolders(deps: Deps, ctx: CallContext): Promise<Result<{ path: string; assetCount: number }[]>> {
  const denied = requirePermission(ctx, 'media.upload');
  if (denied) return denied;
  const rows = deps.db.select({ path: mediaFolders.path }).from(mediaFolders).orderBy(asc(mediaFolders.path)).all();
  return ok(
    rows.map((r) => ({
      path: r.path,
      assetCount: deps.db.select({ n: sql<number>`count(*)` }).from(mediaAssets).where(eq(mediaAssets.folder, r.path)).get()?.n ?? 0,
    })),
  );
}

const createInput = z.object({ path: z.string().min(1) });

export async function createMediaFolder(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ path: string }>> {
  const denied = requirePermission(ctx, 'media.upload');
  if (denied) return denied;
  const parsed = createInput.safeParse(input);
  if (!parsed.success) return invalid([{ path: 'path', message: 'invalidFolderPath' }]);
  const path = parseFolderPath(parsed.data.path);
  if (!path) return invalid([{ path: 'path', message: 'invalidFolderPath' }]);

  if (folderExists(deps, path)) return conflict('folderExists', `Der Ordner „${path}“ existiert bereits`);
  const parent = parentOf(path);
  if (parent && !folderExists(deps, parent)) return conflict('folderParentMissing', `Der übergeordnete Ordner „${parent}“ fehlt`);

  deps.db.transaction((tx) => {
    tx.insert(mediaFolders).values({ path, createdAt: isoNow(deps.clock) }).run();
    recordAudit(tx, deps, ctx, {
      action: 'media.folder.create',
      entityType: 'mediaFolder',
      entityId: path,
      after: { path },
      summary: `Ordner „${path}“ angelegt`,
    });
  });
  return ok({ path });
}

const renameInput = z.object({ from: z.string().min(1), to: z.string().min(1) });

export async function renameMediaFolder(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ path: string }>> {
  const denied = requirePermission(ctx, 'media.upload');
  if (denied) return denied;
  const parsed = renameInput.safeParse(input);
  if (!parsed.success) return invalid([{ path: 'to', message: 'invalidFolderPath' }]);
  const from = parseFolderPath(parsed.data.from);
  const to = parseFolderPath(parsed.data.to);
  if (!from || !to) return invalid([{ path: 'to', message: 'invalidFolderPath' }]);

  if (!folderExists(deps, from)) return notFound('mediaFolder', from);
  if (folderExists(deps, to)) return conflict('folderExists', `Der Ordner „${to}“ existiert bereits`);
  const toParent = parentOf(to);
  if (toParent && !folderExists(deps, toParent)) return conflict('folderParentMissing', `Der übergeordnete Ordner „${toParent}“ fehlt`);

  const affected = deps.db
    .select({ path: mediaFolders.path })
    .from(mediaFolders)
    .where(sql`${mediaFolders.path} = ${from} or ${mediaFolders.path} like ${from + '/%'}`)
    .all()
    .map((r) => r.path);

  deps.db.transaction((tx) => {
    for (const oldPath of affected) {
      const newPath = to + oldPath.slice(from.length);
      tx.update(mediaFolders).set({ path: newPath }).where(eq(mediaFolders.path, oldPath)).run();
      tx.update(mediaAssets).set({ folder: newPath }).where(eq(mediaAssets.folder, oldPath)).run();
    }
    recordAudit(tx, deps, ctx, {
      action: 'media.folder.rename',
      entityType: 'mediaFolder',
      entityId: from,
      before: { path: from },
      after: { path: to },
      summary: `Ordner „${from}“ in „${to}“ umbenannt`,
    });
  });
  return ok({ path: to });
}

const pathInput = z.object({ path: z.string().min(1) });

export async function deleteMediaFolder(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<null>> {
  const denied = requirePermission(ctx, 'media.upload');
  if (denied) return denied;
  const parsed = pathInput.safeParse(input);
  if (!parsed.success) return invalid([{ path: 'path', message: 'invalidFolderPath' }]);
  const path = parseFolderPath(parsed.data.path);
  if (!path) return invalid([{ path: 'path', message: 'invalidFolderPath' }]);

  if (!folderExists(deps, path)) return notFound('mediaFolder', path);
  const hasAsset = !!deps.db.select({ id: mediaAssets.id }).from(mediaAssets).where(eq(mediaAssets.folder, path)).get();
  const hasChild = !!deps.db.select({ path: mediaFolders.path }).from(mediaFolders).where(like(mediaFolders.path, path + '/%')).get();
  if (hasAsset || hasChild) return conflict('folderNotEmpty', `Der Ordner „${path}“ ist nicht leer`);

  deps.db.transaction((tx) => {
    tx.delete(mediaFolders).where(eq(mediaFolders.path, path)).run();
    recordAudit(tx, deps, ctx, {
      action: 'media.folder.delete',
      entityType: 'mediaFolder',
      entityId: path,
      before: { path },
      summary: `Ordner „${path}“ gelöscht`,
    });
  });
  return ok(null);
}

const moveInput = z.object({ id: z.string().min(1), folder: z.string().min(1).nullable() });

export async function moveMediaAsset(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<null>> {
  const denied = requirePermission(ctx, 'media.upload');
  if (denied) return denied;
  const parsed = moveInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })));

  const asset = deps.db.select().from(mediaAssets).where(eq(mediaAssets.id, parsed.data.id)).get();
  if (!asset) return notFound('mediaAsset', parsed.data.id);

  let folder: string | null = null;
  if (parsed.data.folder !== null) {
    folder = parseFolderPath(parsed.data.folder);
    if (!folder || !folderExists(deps, folder)) return notFound('mediaFolder', parsed.data.folder ?? '');
  }

  deps.db.transaction((tx) => {
    tx.update(mediaAssets).set({ folder }).where(eq(mediaAssets.id, asset.id)).run();
    recordAudit(tx, deps, ctx, {
      action: 'media.move',
      entityType: 'mediaAsset',
      entityId: asset.id,
      before: { folder: asset.folder },
      after: { folder },
      summary: `Datei „${asset.filename}“ nach „${folder ?? 'Wurzel'}“ verschoben`,
    });
  });
  return ok(null);
}
