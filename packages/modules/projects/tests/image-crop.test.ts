import { coreModule, moduleMcpTools, schema as core, setSetting, storeMediaAsset, unwrap, writeSettingInternal } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { projectsModule } from '../src/manifest';
import { createProject, setProjectPublished, updateProject } from '../src/service';
import { publishedProjects } from '../src/views';
import { projectsMediaReferences } from '../src/references';

// Spec Ausschnitt für alle Bilder § 3: das Projektbild bekommt einen Ausschnitt (`imageCrop`).
const manage = ctxWith(['projects.manage', 'projects.view', 'media.upload']);
const base = { slug: 'grundversorgung', name: { de: 'Grundversorgung', en: '' }, type: 'ongoing' as const, summary: { de: 'x', en: '' }, body: { de: 'y', en: '' } };
// Zwei verschiedene 1×1-PNGs: Die Mediathek dedupliziert nach Inhalt.
const PNGS = ['iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='];
const png = async (n: number) => Uint8Array.from(Buffer.from(PNGS[n - 1]!, 'base64'));

const setup = async () => {
  const deps = createTestDeps({ manifests: [coreModule, projectsModule] });
  insertUser(deps, { id: 'USER-TEST' });
  await setSetting(deps, ctxWith(['settings.manage']), { key: 'i18n.locales', value: ['de', 'en'] });
  deps.db.transaction((tx) => writeSettingInternal(tx, deps, ctxWith(['settings.manage']), 'modules.enabled', ['projects']));
  const m1 = unwrap(await storeMediaAsset(deps, manage, { originalName: 'a.png', bytes: await png(1) }));
  const m2 = unwrap(await storeMediaAsset(deps, manage, { originalName: 'b.png', bytes: await png(2) }));
  return { deps, m1, m2 };
};

describe('project image crop', () => {
  it('stores a rounded crop on create, refuses one outside the picture and one without a picture', async () => {
    const { deps, m1 } = await setup();
    const p = unwrap(await createProject(deps, manage, { ...base, imageAssetId: m1.id, imageCrop: { x: 0.123456, y: 0, w: 0.5, h: 1 } }));
    expect(p.imageCrop).toEqual({ x: 0.1235, y: 0, w: 0.5, h: 1 });
    const outside = await createProject(deps, manage, { ...base, slug: 'b', imageAssetId: m1.id, imageCrop: { x: 0.6, y: 0, w: 0.5, h: 1 } });
    expect(outside.ok === false && outside.error.type === 'validation').toBe(true);
    const lonely = unwrap(await createProject(deps, manage, { ...base, slug: 'c', imageCrop: { x: 0, y: 0, w: 0.5, h: 1 } }));
    expect(lonely.imageCrop).toBeNull();
  });

  it('keeps the crop while the image stays, drops it with another or no image, null removes it', async () => {
    const { deps, m1, m2 } = await setup();
    const crop = { x: 0, y: 0.1, w: 1, h: 0.8 };
    const p = unwrap(await createProject(deps, manage, { ...base, imageAssetId: m1.id, imageCrop: crop }));
    expect(unwrap(await updateProject(deps, manage, { id: p.id, name: { de: 'Neu', en: '' } })).imageCrop).toEqual(crop);
    expect(unwrap(await updateProject(deps, manage, { id: p.id, imageAssetId: m1.id })).imageCrop).toEqual(crop);
    expect(unwrap(await updateProject(deps, manage, { id: p.id, imageAssetId: m2.id })).imageCrop).toBeNull();
    unwrap(await updateProject(deps, manage, { id: p.id, imageCrop: crop }));
    expect(unwrap(await updateProject(deps, manage, { id: p.id, imageCrop: null })).imageCrop).toBeNull();
    unwrap(await updateProject(deps, manage, { id: p.id, imageCrop: crop }));
    expect(unwrap(await updateProject(deps, manage, { id: p.id, imageAssetId: null })).imageCrop).toBeNull();
    expect(deps.db.select().from(core.auditLog).all().at(-1)).toMatchObject({ action: 'projects.update' });
  });

  it('gives the published view the derived ID', async () => {
    const { deps, m1 } = await setup();
    const p = unwrap(await createProject(deps, manage, { ...base, imageAssetId: m1.id, imageCrop: { x: 0.1, y: 0, w: 0.8, h: 1 } }));
    unwrap(await setProjectPublished(deps, manage, { id: p.id, isPublished: true }));
    const row = publishedProjects.load(deps)[0] as Record<string, unknown>;
    expect(row.imageAssetId).toBe(`${m1.id}~1000_0_8000_10000`);
    expect(publishedProjects.schema.parse(row)).not.toHaveProperty('imageCrop');
  });

  it('takes imageCrop through project_create and project_update; project_get returns it with the image place', async () => {
    const { deps, m1 } = await setup();
    const tools = Object.fromEntries(moduleMcpTools(deps, projectsModule).map((t) => [t.name, t]));
    expect(tools.project_update!.description).toMatch(/imageCrop/);
    const created = unwrap(await tools.project_create!.handler(deps, manage, tools.project_create!.inputSchema.parse({ ...base, imageAssetId: m1.id, imageCrop: { x: 0, y: 0, w: 0.5, h: 1 } }))) as { id: string };
    unwrap(await tools.project_update!.handler(deps, manage, tools.project_update!.inputSchema.parse({ id: created.id, imageCrop: { x: 0, y: 0, w: 1, h: 0.5 } })));
    const got = unwrap(await tools.project_get!.handler(deps, manage, { id: created.id })) as { imageCrop: unknown; imagePlaces: Record<string, { formats: string[] }> };
    expect(got.imageCrop).toEqual({ x: 0, y: 0, w: 1, h: 0.5 });
    expect(got.imagePlaces).toEqual({ 'projects.image': { formats: [], places: [{ ratio: 'original', minWidthPx: 960, labelKey: 'media.crop.places.projectImage' }], source: 'none' } });
  });
});

describe('media references with crop', () => {
  it('marks the project image with crop as cropped', async () => {
    const { deps, m1, m2 } = await setup();
    const p = unwrap(await createProject(deps, manage, { ...base, imageAssetId: m1.id, imageCrop: { x: 0, y: 0, w: 0.5, h: 1 } }));
    const q = unwrap(await createProject(deps, manage, { ...base, slug: 'zwei', imageAssetId: m2.id }));
    expect(projectsMediaReferences(deps, new Set([m1.id, m2.id]))).toEqual([
      expect.objectContaining({ assetId: m1.id, id: p.id, cropped: true }),
      expect.objectContaining({ assetId: m2.id, id: q.id, cropped: false }),
    ]);
  });
});
