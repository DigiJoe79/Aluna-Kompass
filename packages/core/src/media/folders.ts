import { and, asc, eq, isNull, like, ne, sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';
import { recordAudit } from '../audit/log';
import { isoNow } from '../clock';
import type { CallContext } from '../context';
import { mediaAssets, mediaFolders } from '../db/schema';
import type { Deps } from '../deps';
import { requirePermission } from '../permissions/check';
import { conflict, invalid, localizedConflict, notFound, ok, type Failure, type Result } from '../result';
import { zodIssues } from '../validate';

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

export type FolderMoveBlock = 'sameLocation' | 'insideItself' | 'tooDeep' | 'tooLong' | 'exists' | 'notFound';

const isWithin = (path: string, root: string) => path === root || path.startsWith(root + '/');

/** Alle Pfade des Teilbaums `from` (einschließlich `from`), alt → neu, oder der Grund, warum nicht. Rein, ohne DB-Zugriff. */
export function planFolderMove(
  existing: readonly string[],
  from: string,
  to: string,
): { ok: true; renames: { from: string; to: string }[] } | { ok: false; reason: FolderMoveBlock } {
  if (!existing.includes(from)) return { ok: false, reason: 'notFound' };
  if (from === to) return { ok: false, reason: 'sameLocation' };
  if (isWithin(to, from)) return { ok: false, reason: 'insideItself' };
  // Pfade vergleicht SQLite binär: Ändert sich nur die Schreibweise, steht `to` nicht in `existing`.
  if (existing.includes(to)) return { ok: false, reason: 'exists' };
  const renames = existing
    .filter((p) => isWithin(p, from))
    .sort()
    .map((p) => ({ from: p, to: to + p.slice(from.length) }));
  // Die Teilbäume sind disjunkt (`to` liegt nicht in `from`): Jedes neue Ziel, das es schon gibt, wäre eine Kollision.
  if (renames.some((r) => existing.includes(r.to))) return { ok: false, reason: 'exists' };
  for (const r of renames) {
    if (r.to.split('/').length > 8) return { ok: false, reason: 'tooDeep' };
    if (r.to.length > 200) return { ok: false, reason: 'tooLong' };
  }
  return { ok: true, renames };
}

/** SQL-Bedingung „path ist `root` oder liegt darunter“ ohne LIKE-Platzhalter. */
export const withinSubtree = (column: SQLiteColumn, root: string): SQL =>
  sql`(${column} = ${root} or substr(${column}, 1, length(${root}) + 1) = ${root} || '/')`;

/** `folderParentMissing`, lokalisiert; `name` = letztes Segment des fehlenden Elternordners. */
export const folderParentMissing = (parent: string): Failure =>
  localizedConflict('folderParentMissing', 'errors.folder.parentMissing', { name: parent.slice(parent.lastIndexOf('/') + 1) });

/** Nicht-null `expectedFolder` in kanonische Form bringen; `undefined` bleibt, ungültig ergibt `null`. */
export const normalizeExpectedFolder = (raw: string | null | undefined): string | null | undefined | false =>
  raw === undefined || raw === null ? raw : (parseFolderPath(raw) ?? false);

/** Code `folderExists` bzw. `folder<Reason>`; `name` = letztes Segment von `to`, für Texte ohne Schrägstrich. */
export const folderMoveConflict = (
  reason: Exclude<FolderMoveBlock, 'notFound'>,
  params: { from: string; to: string; name: string },
): Failure =>
  localizedConflict(reason === 'exists' ? 'folderExists' : `folder${reason[0]!.toUpperCase()}${reason.slice(1)}`, `errors.folder.${reason}`, params);

const parentOf = (path: string): string | null => {
  const i = path.lastIndexOf('/');
  return i === -1 ? null : path.slice(0, i);
};

export function folderExists(deps: Pick<Deps, 'db'>, path: string): boolean {
  return !!deps.db.select({ path: mediaFolders.path }).from(mediaFolders).where(eq(mediaFolders.path, path)).get();
}

/** Die Art einer Datei als SQL-Bedingung (Bilder, PDFs); ohne Art keine. */
export const mediaKindCondition = (kind: 'image' | 'pdf' | undefined): SQL | undefined =>
  kind === 'image' ? like(mediaAssets.mimeType, 'image/%') : kind === 'pdf' ? eq(mediaAssets.mimeType, 'application/pdf') : undefined;

/** Nur Dateien dieser Art zählen — der Auswahldialog zählt, was er zeigt (README § 3, Artboard 8). */
export interface MediaCountInput {
  kind?: 'image' | 'pdf';
}

/** Wie viele Dateien in keinem Ordner liegen — der Zähler an „Ohne Ordner“, ohne die Liste zu laden. */
export async function countUnfiledMediaAssets(deps: Deps, ctx: CallContext, input: MediaCountInput = {}): Promise<Result<number>> {
  const denied = requirePermission(ctx, 'media.upload');
  if (denied) return denied;
  return ok(deps.db.select({ n: sql<number>`count(*)` }).from(mediaAssets).where(and(isNull(mediaAssets.folder), mediaKindCondition(input.kind))).get()?.n ?? 0);
}

/** Alle Ordner mit der Zahl der Dateien direkt darin; mit `kind` nur Dateien dieser Art. */
export async function listMediaFolders(deps: Deps, ctx: CallContext, input: MediaCountInput = {}): Promise<Result<{ path: string; assetCount: number }[]>> {
  const denied = requirePermission(ctx, 'media.upload');
  if (denied) return denied;
  const rows = deps.db.select({ path: mediaFolders.path }).from(mediaFolders).orderBy(asc(mediaFolders.path)).all();
  const kind = mediaKindCondition(input.kind);
  return ok(
    rows.map((r) => ({
      path: r.path,
      assetCount: deps.db.select({ n: sql<number>`count(*)` }).from(mediaAssets).where(and(eq(mediaAssets.folder, r.path), kind)).get()?.n ?? 0,
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
  if (parent && !folderExists(deps, parent)) return folderParentMissing(parent);

  deps.db.transaction((tx) => {
    tx.insert(mediaFolders).values({ path, createdAt: isoNow(deps.clock) }).run();
    recordAudit(tx, deps, ctx, {
      action: 'media.folder.create',
      entityType: 'mediaFolder',
      entityId: path,
      after: { path },
      params: { path },
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

  const existing = deps.db.select({ path: mediaFolders.path }).from(mediaFolders).all().map((r) => r.path);
  const plan = planFolderMove(existing, from, to);
  if (!plan.ok) {
    if (plan.reason === 'notFound') return notFound('mediaFolder', from);
    return folderMoveConflict(plan.reason, { from, to, name: to.slice(to.lastIndexOf('/') + 1) });
  }
  const toParent = parentOf(to);
  if (toParent && !folderExists(deps, toParent)) return folderParentMissing(toParent);

  deps.db.transaction((tx) => {
    let assets = 0;
    for (const r of plan.renames) {
      tx.update(mediaFolders).set({ path: r.to }).where(eq(mediaFolders.path, r.from)).run();
      assets += tx.update(mediaAssets).set({ folder: r.to }).where(eq(mediaAssets.folder, r.from)).run().changes;
    }
    recordAudit(tx, deps, ctx, {
      action: 'media.folder.rename',
      entityType: 'mediaFolder',
      entityId: from,
      before: { path: from },
      after: { path: to, folders: plan.renames.length, assets },
      params: { from, to },
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
  const hasChild = !!deps.db.select({ path: mediaFolders.path }).from(mediaFolders).where(and(ne(mediaFolders.path, path), withinSubtree(mediaFolders.path, path))).get();
  if (hasAsset || hasChild) return conflict('folderNotEmpty', `Der Ordner „${path}“ ist nicht leer`);

  deps.db.transaction((tx) => {
    tx.delete(mediaFolders).where(eq(mediaFolders.path, path)).run();
    recordAudit(tx, deps, ctx, {
      action: 'media.folder.delete',
      entityType: 'mediaFolder',
      entityId: path,
      before: { path },
      params: { path },
    });
  });
  return ok(null);
}

const moveInput = z.object({ id: z.string().min(1), folder: z.string().min(1).nullable(), expectedFolder: z.string().min(1).nullable().optional() });

/**
 * Verschiebt eine Datei. Liegt sie schon im Ziel, geschieht nichts und nichts
 * wird protokolliert (`moved: false`) — Rechte, Existenz und `expectedFolder`
 * prüft der Dienst trotzdem zuerst.
 */
export async function moveMediaAsset(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ moved: boolean }>> {
  const denied = requirePermission(ctx, 'media.upload');
  if (denied) return denied;
  const parsed = moveInput.safeParse(input);
  if (!parsed.success) return invalid(zodIssues(parsed.error));

  const asset = deps.db.select().from(mediaAssets).where(eq(mediaAssets.id, parsed.data.id)).get();
  if (!asset) return notFound('mediaAsset', parsed.data.id);
  const expected = normalizeExpectedFolder(parsed.data.expectedFolder);
  if (expected === false) return invalid([{ path: 'expectedFolder', message: 'invalidFolderPath' }]);
  if (expected !== undefined && asset.folder !== expected) {
    return localizedConflict('movedInBetween', 'errors.folder.movedInBetween', { id: asset.id });
  }

  let folder: string | null = null;
  if (parsed.data.folder !== null) {
    folder = parseFolderPath(parsed.data.folder);
    if (!folder || !folderExists(deps, folder)) return notFound('mediaFolder', parsed.data.folder ?? '');
  }
  if (asset.folder === folder) return ok({ moved: false });

  deps.db.transaction((tx) => {
    tx.update(mediaAssets).set({ folder }).where(eq(mediaAssets.id, asset.id)).run();
    recordAudit(tx, deps, ctx, {
      action: 'media.move',
      entityType: 'mediaAsset',
      entityId: asset.id,
      before: { folder: asset.folder },
      after: { folder },
      params: { filename: asset.filename, folder: folder ?? '', toRoot: folder === null },
    });
  });
  return ok({ moved: true });
}
