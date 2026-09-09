import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { auditLog, mediaAssets, mediaFolders } from '../src/db/schema';
import {
  createMediaFolder,
  deleteMediaFolder,
  listMediaFolders,
  moveMediaAsset,
  renameMediaFolder,
} from '../src/media/folders';
import { storeMediaAsset } from '../src/media/service';
import { unwrap } from '../src/result';
import { createTestDeps, ctxWith, insertUser } from '../src/testing';

const PNG = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'),
);

const insertAsset = (deps: ReturnType<typeof createTestDeps>, id: string, folder: string | null) =>
  deps.db
    .insert(mediaAssets)
    .values({ id, filename: `${id.toLowerCase()}-000000000000.png`, mimeType: 'image/png', bytes: 1, width: 1, height: 1, uploadedByUserId: null, createdAt: '2026-09-05T08:00:00.000Z', folder })
    .run();

describe('media folders — create & list', () => {
  it('creates a folder and a subfolder, lists them with asset counts', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    unwrap(await createMediaFolder(deps, ctx, { path: 'tiere' }));
    unwrap(await createMediaFolder(deps, ctx, { path: 'tiere/2024' }));

    const list = unwrap(await listMediaFolders(deps, ctx));
    expect(list.map((f) => f.path)).toEqual(['tiere', 'tiere/2024']);
    expect(list.every((f) => f.assetCount === 0)).toBe(true);
    expect(deps.db.select().from(auditLog).all().at(-1)).toMatchObject({
      action: 'media.folder.create',
      entityType: 'mediaFolder',
      entityId: 'tiere/2024',
    });
  });

  it('refuses a duplicate, a missing parent, bad segments and a missing permission', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    unwrap(await createMediaFolder(deps, ctx, { path: 'tiere' }));

    const dup = await createMediaFolder(deps, ctx, { path: 'tiere' });
    expect(dup.ok === false && dup.error.type === 'conflict' && dup.error.code === 'folderExists').toBe(true);

    const orphan = await createMediaFolder(deps, ctx, { path: 'a/b' });
    expect(orphan.ok === false && orphan.error.type === 'conflict' && orphan.error.code === 'folderParentMissing').toBe(true);

    // Groß-/Kleinschreibung und Leerzeichen sind erlaubt (Beschriftung, kein Slug)
    unwrap(await createMediaFolder(deps, ctx, { path: 'Kampagnen 2024' }));
    // aber `..` als Segment nicht
    const bad = await createMediaFolder(deps, ctx, { path: 'a/../b' });
    expect(bad.ok === false && bad.error.type === 'validation').toBe(true);

    const noPerm = await createMediaFolder(deps, ctxWith([], 'U'), { path: 'x' });
    expect(noPerm.ok === false && noPerm.error.type === 'forbidden').toBe(true);
  });
});

describe('media folders — rename & delete', () => {
  it('rename carries subfolders and assets along', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    unwrap(await createMediaFolder(deps, ctx, { path: 'tiere' }));
    unwrap(await createMediaFolder(deps, ctx, { path: 'tiere/2024' }));
    insertAsset(deps, 'A1', 'tiere/2024');

    unwrap(await renameMediaFolder(deps, ctx, { from: 'tiere', to: 'hunde' }));

    expect(deps.db.select({ path: mediaFolders.path }).from(mediaFolders).all().map((r) => r.path).sort()).toEqual(['hunde', 'hunde/2024']);
    expect(deps.db.select({ folder: mediaAssets.folder }).from(mediaAssets).where(eq(mediaAssets.id, 'A1')).get()!.folder).toBe('hunde/2024');
  });

  it('delete removes an empty folder, refuses one with an asset or a subfolder', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    unwrap(await createMediaFolder(deps, ctx, { path: 'leer' }));
    unwrap(await deleteMediaFolder(deps, ctx, { path: 'leer' }));
    expect(deps.db.select().from(mediaFolders).all()).toEqual([]);

    unwrap(await createMediaFolder(deps, ctx, { path: 'voll' }));
    insertAsset(deps, 'A2', 'voll');
    const withAsset = await deleteMediaFolder(deps, ctx, { path: 'voll' });
    expect(withAsset.ok === false && withAsset.error.type === 'conflict' && withAsset.error.code === 'folderNotEmpty').toBe(true);

    unwrap(await createMediaFolder(deps, ctx, { path: 'ober' }));
    unwrap(await createMediaFolder(deps, ctx, { path: 'ober/unter' }));
    const withChild = await deleteMediaFolder(deps, ctx, { path: 'ober' });
    expect(withChild.ok === false && withChild.error.type === 'conflict' && withChild.error.code === 'folderNotEmpty').toBe(true);
  });

  it('rename refuses a missing source and an occupied target; delete refuses without permission', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    unwrap(await createMediaFolder(deps, ctx, { path: 'a' }));
    unwrap(await createMediaFolder(deps, ctx, { path: 'b' }));
    expect((await renameMediaFolder(deps, ctx, { from: 'x', to: 'y' })).ok).toBe(false);
    const occupied = await renameMediaFolder(deps, ctx, { from: 'a', to: 'b' });
    expect(occupied.ok === false && occupied.error.type === 'conflict' && occupied.error.code === 'folderExists').toBe(true);
    expect((await deleteMediaFolder(deps, ctxWith([], 'U'), { path: 'a' })).ok).toBe(false);
  });
});

describe('media move & upload into a folder', () => {
  it('moves an asset into an existing folder and records it', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    unwrap(await createMediaFolder(deps, ctx, { path: 'tiere' }));
    const asset = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'a.png', bytes: PNG }));

    unwrap(await moveMediaAsset(deps, ctx, { id: asset.id, folder: 'tiere' }));
    expect(deps.db.select({ f: mediaAssets.folder }).from(mediaAssets).where(eq(mediaAssets.id, asset.id)).get()!.f).toBe('tiere');
    expect(deps.db.select().from(auditLog).all().at(-1)).toMatchObject({ action: 'media.move', entityId: asset.id });

    unwrap(await moveMediaAsset(deps, ctx, { id: asset.id, folder: null }));
    expect(deps.db.select({ f: mediaAssets.folder }).from(mediaAssets).where(eq(mediaAssets.id, asset.id)).get()!.f).toBeNull();
  });

  it('refuses a move into a non-existent folder', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    const asset = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'a.png', bytes: PNG }));
    const res = await moveMediaAsset(deps, ctx, { id: asset.id, folder: 'weg' });
    expect(res.ok === false && res.error.type === 'notFound' && res.error.entity === 'mediaFolder').toBe(true);
  });

  it('stores an upload into a folder, and dedup keeps the existing folder', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    unwrap(await createMediaFolder(deps, ctx, { path: 'a' }));
    unwrap(await createMediaFolder(deps, ctx, { path: 'b' }));
    const first = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'x.png', bytes: PNG, folder: 'a' }));
    expect(first.folder).toBe('a');
    const again = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'x.png', bytes: PNG, folder: 'b' }));
    expect(again.id).toBe(first.id);
    expect(again.folder).toBe('a');
  });
});
