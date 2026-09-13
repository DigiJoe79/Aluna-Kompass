import { describe, expect, it } from 'vitest';
import { mediaAssets, mediaFolders } from '../src/db/schema';
import { previewFilename } from '../src/media/preview';
import { seedMedia } from '../src/seed/media';
import { seedDevelopment } from '../src/seed/seed';
import { createTestDeps, ctxWith, insertUser } from '../src/testing';

describe('seedMedia', () => {
  it('creates folders and example files with previews, and is idempotent', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    await seedMedia(deps, ctx);
    await seedMedia(deps, ctx);

    expect(deps.db.select().from(mediaFolders).all().map((f) => f.path).sort()).toEqual(['Bilder', 'Bilder/2026', 'Dokumente']);
    const assets = deps.db.select().from(mediaAssets).all();
    expect(assets).toHaveLength(6);
    expect(assets.filter((a) => a.mimeType === 'application/pdf').map((a) => a.folder)).toEqual(['Dokumente']);
    expect(assets.filter((a) => a.mimeType === 'image/svg+xml').map((a) => a.folder)).toEqual([null]);
    expect(assets.filter((a) => a.folder === 'Bilder/2026')).toHaveLength(2);
    expect(assets.filter((a) => a.folder === null)).toHaveLength(2); // ein Bild, das SVG
    for (const a of assets.filter((a) => a.mimeType !== 'application/pdf' && a.mimeType !== 'image/svg+xml')) {
      expect(await deps.media.exists(previewFilename(a.filename))).toBe(true);
    }
  });

  it('runs as part of seedDevelopment', async () => {
    const deps = createTestDeps({ env: 'development' });
    await seedDevelopment(deps);
    expect(deps.db.select().from(mediaFolders).all().length).toBeGreaterThanOrEqual(3);
  });
});
