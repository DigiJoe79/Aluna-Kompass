import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { auditLog, mediaAssets, mediaFolders } from '../src/db/schema';
import {
  countUnfiledMediaAssets,
  createMediaFolder,
  deleteMediaFolder,
  listMediaFolders,
  moveMediaAsset,
  renameMediaFolder,
} from '../src/media/folders';
import { listMediaAssets, mediaListFilterSchema, storeMediaAsset } from '../src/media/service';
import { unwrap } from '../src/result';
import { auditEntry, createTestDeps, ctxWith, insertUser } from '../src/testing';

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
    expect(orphan.ok === false && orphan.error.type === 'conflict' && orphan.error.messageKey).toBe('errors.folder.parentMissing');
    expect(orphan.ok === false && orphan.error.type === 'conflict' && orphan.error.params).toEqual({ name: 'a' });

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
    const entry = auditEntry(deps, 'media.folder.rename');
    expect(entry).toMatchObject({ entityType: 'mediaFolder', entityId: 'tiere' });
    expect(JSON.parse(entry.before!)).toEqual({ path: 'tiere' });
    expect(JSON.parse(entry.after!)).toEqual({ path: 'hunde', folders: 2, assets: 1 });
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

describe('media folders — Zielprüfung', () => {
  it('rename does not take a neighbour with LIKE wildcards along', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    for (const path of ['Bilder', 'Bilder_alt', 'Bilder_alt/x']) unwrap(await createMediaFolder(deps, ctx, { path }));
    unwrap(await renameMediaFolder(deps, ctx, { from: 'Bilder', to: 'Fotos' }));
    expect(deps.db.select({ path: mediaFolders.path }).from(mediaFolders).all().map((r) => r.path).sort()).toEqual(['Bilder_alt', 'Bilder_alt/x', 'Fotos']);
  });

  it('refuses a target inside the folder itself', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    for (const path of ['Bilder', 'Bilder/2026']) unwrap(await createMediaFolder(deps, ctx, { path }));
    const res = await renameMediaFolder(deps, ctx, { from: 'Bilder', to: 'Bilder/2026/Bilder' });
    expect(res.ok === false && res.error.type === 'conflict' && res.error.code).toBe('folderInsideItself');
  });

  it('refuses a subtree that would become too deep and changes nothing', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    const chain = ['a', 'a/2', 'a/2/3', 'a/2/3/4', 'a/2/3/4/5', 'a/2/3/4/5/6', 'a/2/3/4/5/6/7', 'p', 'p/q'];
    for (const path of chain) unwrap(await createMediaFolder(deps, ctx, { path }));
    insertAsset(deps, 'A1', 'a/2');
    const auditBefore = deps.db.select().from(auditLog).all().length;
    const res = await renameMediaFolder(deps, ctx, { from: 'a', to: 'p/q/a' });
    expect(res.ok === false && res.error.type === 'conflict' && res.error.code).toBe('folderTooDeep');
    expect(deps.db.select({ path: mediaFolders.path }).from(mediaFolders).all().map((r) => r.path).sort()).toEqual([...chain].sort());
    expect(deps.db.select({ folder: mediaAssets.folder }).from(mediaAssets).get()!.folder).toBe('a/2');
    expect(deps.db.select().from(auditLog).all().length).toBe(auditBefore);
  });

  it('deleteMediaFolder is not fooled by a LIKE-lookalike sibling', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    deps.db.insert(mediaFolders).values([{ path: 'a', createdAt: '2026-09-05T08:00:00.000Z' }, { path: 'a_b', createdAt: '2026-09-05T08:00:00.000Z' }, { path: 'a_b/x', createdAt: '2026-09-05T08:00:00.000Z' }]).run();
    unwrap(await deleteMediaFolder(deps, ctx, { path: 'a' }));
    expect(deps.db.select({ path: mediaFolders.path }).from(mediaFolders).all().map((r) => r.path).sort()).toEqual(['a_b', 'a_b/x']);
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

describe('media move — expectedFolder', () => {
  it('refuses with movedInBetween when the asset lies elsewhere, leaving it unchanged', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    unwrap(await createMediaFolder(deps, ctx, { path: 'a' }));
    unwrap(await createMediaFolder(deps, ctx, { path: 'b' }));
    insertAsset(deps, 'M1', 'b');
    const r = await moveMediaAsset(deps, ctx, { id: 'M1', folder: null, expectedFolder: 'a' });
    expect(r.ok === false && r.error.type === 'conflict' && r.error.code === 'movedInBetween').toBe(true);
    expect(deps.db.select().from(mediaAssets).where(eq(mediaAssets.id, 'M1')).get()!.folder).toBe('b');
    const ok = await moveMediaAsset(deps, ctx, { id: 'M1', folder: 'a', expectedFolder: 'b' });
    expect(ok.ok).toBe(true);
  });
});

describe('media folders — Sonderzeichen und Normalisierung', () => {
  it('deleteMediaFolder sees a child below an emoji folder', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    deps.db.insert(mediaFolders).values([{ path: '🐶x', createdAt: '2026-09-05T08:00:00.000Z' }, { path: '🐶x/y', createdAt: '2026-09-05T08:00:00.000Z' }]).run();
    const res = await deleteMediaFolder(deps, ctx, { path: '🐶x' });
    expect(res.ok === false && res.error.type === 'conflict' && res.error.code).toBe('folderNotEmpty');
  });

  it('rename refuses a target whose sub-path already exists, instead of hitting the primary key', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    deps.db.insert(mediaFolders).values(['a', 'a/b', 'x', 'x/a/b'].map((path) => ({ path, createdAt: '2026-09-05T08:00:00.000Z' }))).run();
    const res = await renameMediaFolder(deps, ctx, { from: 'a', to: 'x/a' });
    expect(res.ok === false && res.error.type === 'conflict' && res.error.code).toBe('folderExists');
  });

  it('rename with a missing parent is localized', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    unwrap(await createMediaFolder(deps, ctx, { path: 'a' }));
    const res = await renameMediaFolder(deps, ctx, { from: 'a', to: 'fehlt/a' });
    expect(res.ok === false && res.error.type === 'conflict' && [res.error.code, res.error.messageKey, res.error.params]).toEqual(['folderParentMissing', 'errors.folder.parentMissing', { name: 'fehlt' }]);
  });

  it('moveMediaAsset normalizes expectedFolder and rejects an invalid one', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    unwrap(await createMediaFolder(deps, ctx, { path: 'a' }));
    unwrap(await createMediaFolder(deps, ctx, { path: 'b' }));
    insertAsset(deps, 'N1', 'a');
    expect((await moveMediaAsset(deps, ctx, { id: 'N1', folder: 'b', expectedFolder: 'a/' })).ok).toBe(true);
    const bad = await moveMediaAsset(deps, ctx, { id: 'N1', folder: null, expectedFolder: 'a/../b' });
    expect(bad.ok === false && bad.error.type === 'validation' && bad.error.issues).toEqual([{ path: 'expectedFolder', message: 'invalidFolderPath' }]);
  });
});

describe('listMediaAssets: includeSubfolders', () => {
  it('lists the whole subtree, without neighbours whose name only starts alike; default stays exact', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    for (const path of ['Bilder', 'Bilder/2026', 'Bilder/2026/Sommerfest', 'Bilder_alt', 'Bilder%', 'Bilderrahmen']) unwrap(await createMediaFolder(deps, ctx, { path }));
    insertAsset(deps, 'DIREKT', 'Bilder');
    insertAsset(deps, 'JAHR', 'Bilder/2026');
    insertAsset(deps, 'FEST', 'Bilder/2026/Sommerfest');
    insertAsset(deps, 'ALT', 'Bilder_alt');
    insertAsset(deps, 'PROZENT', 'Bilder%');
    insertAsset(deps, 'RAHMEN', 'Bilderrahmen');
    insertAsset(deps, 'LOSE', null);
    const ids = (r: Awaited<ReturnType<typeof listMediaAssets>>) => unwrap(r).map((m) => m.record.id).sort();

    expect(ids(await listMediaAssets(deps, ctx, { folder: 'Bilder', includeSubfolders: true }))).toEqual(['DIREKT', 'FEST', 'JAHR']);
    expect(ids(await listMediaAssets(deps, ctx, { folder: 'Bilder/2026', includeSubfolders: true }))).toEqual(['FEST', 'JAHR']);
    expect(ids(await listMediaAssets(deps, ctx, { folder: 'Bilder' }))).toEqual(['DIREKT']);
    expect(ids(await listMediaAssets(deps, ctx, { folder: 'Bilder', includeSubfolders: false }))).toEqual(['DIREKT']);
    // Ohne Ordner bleibt ohne Ordner, auch mit dem Schalter.
    expect(ids(await listMediaAssets(deps, ctx, { folder: null, includeSubfolders: true }))).toEqual(['LOSE']);
  });

  it('the shared filter schema accepts the switch and refuses anything but a boolean', () => {
    expect(mediaListFilterSchema.safeParse({ folder: 'Bilder', includeSubfolders: true }).success).toBe(true);
    expect(mediaListFilterSchema.safeParse({ includeSubfolders: 'ja' }).success).toBe(false);
  });
});

describe('counting by kind (chooser)', () => {
  const insertPdf = (deps: ReturnType<typeof createTestDeps>, id: string, folder: string | null) =>
    deps.db
      .insert(mediaAssets)
      .values({ id, filename: `${id.toLowerCase()}-000000000000.pdf`, mimeType: 'application/pdf', bytes: 1, width: null, height: null, uploadedByUserId: null, createdAt: '2026-09-05T08:00:00.000Z', folder })
      .run();

  it('listMediaFolders with kind counts only that kind; without input everything', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    unwrap(await createMediaFolder(deps, ctx, { path: 'Bilder' }));
    unwrap(await createMediaFolder(deps, ctx, { path: 'Satzung' }));
    insertAsset(deps, 'BILD1', 'Bilder');
    insertPdf(deps, 'PDF1', 'Bilder');
    insertPdf(deps, 'PDF2', 'Satzung');

    expect(unwrap(await listMediaFolders(deps, ctx))).toEqual([
      { path: 'Bilder', assetCount: 2 },
      { path: 'Satzung', assetCount: 1 },
    ]);
    expect(unwrap(await listMediaFolders(deps, ctx, { kind: 'image' }))).toEqual([
      { path: 'Bilder', assetCount: 1 },
      { path: 'Satzung', assetCount: 0 },
    ]);
    expect(unwrap(await listMediaFolders(deps, ctx, { kind: 'pdf' }))).toEqual([
      { path: 'Bilder', assetCount: 1 },
      { path: 'Satzung', assetCount: 1 },
    ]);
  });

  it('countUnfiledMediaAssets with kind counts only that kind', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    insertAsset(deps, 'BILD1', null);
    insertPdf(deps, 'PDF1', null);
    insertPdf(deps, 'PDF2', null);
    expect(unwrap(await countUnfiledMediaAssets(deps, ctx))).toBe(3);
    expect(unwrap(await countUnfiledMediaAssets(deps, ctx, { kind: 'image' }))).toBe(1);
    expect(unwrap(await countUnfiledMediaAssets(deps, ctx, { kind: 'pdf' }))).toBe(2);
  });
});

describe('countUnfiledMediaAssets', () => {
  it('counts only assets without a folder and needs media.upload', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    unwrap(await createMediaFolder(deps, ctx, { path: 'Bilder' }));
    insertAsset(deps, 'LOSE1', null);
    insertAsset(deps, 'LOSE2', null);
    insertAsset(deps, 'DRIN', 'Bilder');
    expect(unwrap(await countUnfiledMediaAssets(deps, ctx))).toBe(2);
    const denied = await countUnfiledMediaAssets(deps, ctxWith([], insertUser(deps, {})));
    expect(denied.ok === false && denied.error.type === 'forbidden').toBe(true);
  });
});

describe('moveMediaAsset: into the folder it already lives in', () => {
  it('is a no-op without an audit entry and says so', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    unwrap(await createMediaFolder(deps, ctx, { path: 'Bilder' }));
    insertAsset(deps, 'DA', 'Bilder');
    insertAsset(deps, 'LOSE', null);
    const before = deps.db.select().from(auditLog).all().length;
    expect(unwrap(await moveMediaAsset(deps, ctx, { id: 'DA', folder: 'Bilder' }))).toEqual({ moved: false });
    expect(unwrap(await moveMediaAsset(deps, ctx, { id: 'LOSE', folder: null }))).toEqual({ moved: false });
    expect(deps.db.select().from(auditLog).all().length).toBe(before);
    // Rechte und Existenz gehen vor, auch wenn nichts zu tun wäre.
    const denied = await moveMediaAsset(deps, ctxWith([], insertUser(deps, {})), { id: 'DA', folder: 'Bilder' });
    expect(denied.ok === false && denied.error.type === 'forbidden').toBe(true);
    const missing = await moveMediaAsset(deps, ctx, { id: 'NOPE', folder: 'Bilder' });
    expect(missing.ok === false && missing.error.type === 'notFound').toBe(true);
    // Ein echter Zug meldet sich als solcher.
    expect(unwrap(await moveMediaAsset(deps, ctx, { id: 'LOSE', folder: 'Bilder' }))).toEqual({ moved: true });
  });
});
