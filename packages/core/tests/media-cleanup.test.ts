import { describe, expect, it } from 'vitest';
import { auditLog } from '../src/db/schema';
import { deleteUnreferencedMedia, describeMediaUsage, storeMediaAsset } from '../src/media/service';
import { previewFilename } from '../src/media/preview';
import { unwrap } from '../src/result';
import { setSetting } from '../src/settings/service';
import { createTestDeps, ctxWith, insertUser } from '../src/testing';

const PNG = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'),
);
const PNG2 = new Uint8Array([...PNG, 0]);

async function setup() {
  const deps = createTestDeps();
  const ctx = ctxWith(['media.upload', 'settings.manage'], insertUser(deps, {}));
  const free = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'frei.png', bytes: PNG }));
  const logo = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'logo.png', bytes: PNG2 }));
  unwrap(await setSetting(deps, ctx, { key: 'branding.logoAssetId', value: logo.id }));
  return { deps, ctx, free, logo };
}

describe('deleteUnreferencedMedia', () => {
  it('löscht das freie Asset samt Datei und Vorschau, behält das verwendete und nennt die Fundstelle', async () => {
    const { deps, ctx, free, logo } = await setup();
    const result = unwrap(await deleteUnreferencedMedia(deps, ctx, [free.id, logo.id, free.id, 'MISSING']));
    expect(result.deletedMedia).toEqual([free.id]);
    expect(result.keptMedia).toEqual([{ id: logo.id, filename: logo.filename, usedBy: ['Logo des Vereins'] }]);
    expect(await deps.media.exists(free.filename)).toBe(false);
    expect(await deps.media.exists(previewFilename(free.filename))).toBe(false);
    expect(await deps.media.exists(logo.filename)).toBe(true);
    const deletes = deps.db.select().from(auditLog).all().filter((e) => e.action === 'media.delete');
    expect(deletes.map((e) => e.entityId)).toEqual([free.id]);
  });

  it('verlangt media.upload und fasst ohne das Recht nichts an', async () => {
    const { deps, free } = await setup();
    const res = await deleteUnreferencedMedia(deps, ctxWith([], 'U'), [free.id]);
    expect(res.ok === false && res.error.type === 'forbidden').toBe(true);
    expect(await deps.media.exists(free.filename)).toBe(true);
  });
});

describe('describeMediaUsage', () => {
  it('nennt fremde Fundstellen und blendet den Datensatz selbst aus', async () => {
    const { deps, free, logo } = await setup();
    expect(describeMediaUsage(deps, [free.id, logo.id, 'MISSING'], { entity: 'animal', id: 'A1' })).toEqual([
      { id: free.id, filename: free.filename, usedElsewhere: [] },
      { id: logo.id, filename: logo.filename, usedElsewhere: ['Logo des Vereins'] },
    ]);
    expect(describeMediaUsage(deps, [logo.id], { entity: 'setting', id: 'branding.logoAssetId' })).toEqual([
      { id: logo.id, filename: logo.filename, usedElsewhere: [] },
    ]);
  });
});
