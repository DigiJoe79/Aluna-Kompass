import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { coreModule, deleteUnreferencedMedia, findMediaReferences, moduleMcpTools, storeMediaAsset, unwrap, writeSettingInternal } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { createEntry, deleteEntry, entryDeletionPreview, updateEntry } from '../src/entries';
import { exportSiteContent } from '../src/export';
import { siteModule } from '../src/manifest';
import { applyTemplateSync } from '../src/service';
import { setValues } from '../src/values';

// Spec Ausschnitt für alle Bilder § 3: Template-Werte tragen die abgeleitete ID (`<assetId>~x_y_w_h`) direkt als Wert,
// auch in Listen (§ 2). Prüfen, Verwendung, Löschen und Export lesen die Basis.
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const tmp = (prefix: string) => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

const TEMPLATE = `
import { asset, defineTemplate, objectList, text } from '@kompass/site-template';
export default defineTemplate({
  name: 'Bilder', locales: ['de'],
  variables: { hero: asset({ label: 'Bühne', ratio: '16:9', width: 1200 }), claim: text({ label: 'Claim' }) },
  collections: {
    team: { label: 'Team', fields: { name: text({ label: 'Name' }), photo: asset({ label: 'Foto', ratio: '1:1', width: 320 }) } },
    stories: { label: 'Geschichten', fields: { title: text({ label: 'Titel' }), gallery: objectList({ label: 'Galerie', fields: { image: asset({ label: 'Bild', ratio: '4:3' }) } }) } },
  },
});`;

const PNGS = ['iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='];
const manage = ctxWith(['site.manage', 'site.view', 'media.upload']);
const CROP = '1000_0_8000_10000';

async function setup() {
  const deps = createTestDeps({ locales: ['de'], manifests: [coreModule, siteModule] });
  insertUser(deps, { id: 'USER-TEST' });
  deps.db.transaction((tx) => writeSettingInternal(tx, deps, ctxWith(['settings.manage']), 'modules.enabled', ['site']));
  const dir = tmp('kompass-derived-tpl-');
  writeFileSync(path.join(dir, 'kompass.template.ts'), TEMPLATE);
  unwrap(await applyTemplateSync(deps, ctxWith(['site.manage']), { dir, confirm: true }));
  const [a, b] = await Promise.all(PNGS.map(async (p, i) => unwrap(await storeMediaAsset(deps, manage, { originalName: `b${i}.png`, bytes: Uint8Array.from(Buffer.from(p, 'base64')) }))));
  return { deps, dir, a: a!, b: b! };
}

const issues = (r: { ok: boolean; error?: unknown }) => (r.ok ? [] : ((r.error as { issues?: { path: string; message: string }[] }).issues ?? [r.error]));

describe('derived IDs in template values', () => {
  it('takes a derived ID for a variable, and refuses an unknown base or an unreadable rest', async () => {
    const { deps, a } = await setup();
    expect(unwrap(await setValues(deps, manage, { values: { hero: `${a.id}~${CROP}` } })).hero).toBe(`${a.id}~${CROP}`);
    expect(issues(await setValues(deps, manage, { values: { hero: `01ZZZZZZZZZZZZZZZZZZZZZZZZ~${CROP}` } }))).toEqual([{ path: 'hero', message: 'assetNotFound' }]);
    expect(issues(await setValues(deps, manage, { values: { hero: `${a.id}~1_2_3` } }))).toEqual([{ path: 'hero', message: 'invalidCrop' }]);
    expect(issues(await setValues(deps, manage, { values: { hero: 'NICHT-DA' } }))).toEqual([{ path: 'hero', message: 'assetNotFound' }]);
  });

  it('checks asset values inside an object list of an entry', async () => {
    const { deps, a } = await setup();
    const ok = await createEntry(deps, manage, { collection: 'stories', data: { title: 'A', gallery: [{ image: `${a.id}~${CROP}` }] } });
    expect(ok.ok).toBe(true);
    const bad = await createEntry(deps, manage, { collection: 'stories', data: { title: 'B', gallery: [{ image: a.id }, { image: `${a.id}~9_9` }] } });
    expect(issues(bad)).toEqual([{ path: 'gallery.1.image', message: 'invalidCrop' }]);
  });

  it('finds the base as used, marks the use as cropped, also in a list', async () => {
    const { deps, a, b } = await setup();
    unwrap(await setValues(deps, manage, { values: { hero: `${a.id}~${CROP}` } }));
    const team = unwrap(await createEntry(deps, manage, { collection: 'team', data: { name: 'Mia', photo: b.id } }));
    unwrap(await createEntry(deps, manage, { collection: 'stories', data: { title: 'A', gallery: [{ image: `${b.id}~${CROP}` }] } }));
    expect(findMediaReferences(deps, a.id)).toEqual([expect.objectContaining({ entity: 'siteValue', id: 'hero', cropped: true })]);
    const refsB = findMediaReferences(deps, b.id);
    expect(refsB).toHaveLength(2);
    expect(refsB.find((r) => r.id === team.id)).toMatchObject({ entity: 'siteEntry', cropped: false });
    expect(refsB.find((r) => r.id !== team.id)).toMatchObject({ entity: 'siteEntry', cropped: true });
  });

  it('deletes an entry and cleans up the base of a derived ID that nobody else uses', async () => {
    const { deps, a, b } = await setup();
    unwrap(await setValues(deps, manage, { values: { hero: `${b.id}~${CROP}` } }));
    const e = unwrap(await createEntry(deps, manage, { collection: 'stories', data: { title: 'A', gallery: [{ image: `${a.id}~${CROP}` }, { image: `${b.id}~0_0_5000_5000` }] } }));
    const preview = unwrap(await entryDeletionPreview(deps, manage, e.id));
    expect(JSON.stringify(preview)).toContain(a.id);
    const cleaned = unwrap(await deleteEntry(deps, manage, { id: e.id, deleteOrphanedMedia: true }));
    expect(cleaned.deletedMedia).toEqual([a.id]);
    expect(cleaned.keptMedia).toEqual([expect.objectContaining({ id: b.id, usedBy: ['Variable „Bühne“'] })]);
    expect(unwrap(await deleteUnreferencedMedia(deps, manage, [b.id])).deletedMedia).toEqual([]);
  });

  it('keeps an old value that no longer resolves from blocking an update of other fields', async () => {
    const { deps, a } = await setup();
    const e = unwrap(await createEntry(deps, manage, { collection: 'team', data: { name: 'Mia', photo: `${a.id}~${CROP}` } }));
    unwrap(await deleteEntry(deps, manage, { id: e.id }));
    const f = unwrap(await createEntry(deps, manage, { collection: 'team', data: { name: 'Ole', photo: `${a.id}~${CROP}` } }));
    expect((await updateEntry(deps, manage, { id: f.id, data: { name: 'Ole B.' } })).ok).toBe(true);
  });

  it('exports the cut version of a derived ID, also from a list', async () => {
    const { deps, dir, a, b } = await setup();
    unwrap(await setValues(deps, manage, { values: { hero: `${a.id}~${CROP}` } }));
    unwrap(await createEntry(deps, manage, { collection: 'stories', data: { title: 'A', gallery: [{ image: `${b.id}~${CROP}` }] } }));
    const jobDir = tmp('kompass-derived-job-');
    unwrap(await exportSiteContent(deps, ctxWith(['site.publish']), { jobDir, templateDir: dir }));
    const content = JSON.parse(readFileSync(path.join(jobDir, 'content.json'), 'utf8')) as { assets: { id: string; crop?: unknown }[] };
    const ids = content.assets.map((x) => x.id).sort();
    expect(ids).toEqual([`${a.id}~${CROP}`, `${b.id}~${CROP}`].sort());
    expect(content.assets.every((x) => x.crop)).toBe(true);
  });

  it('explains derived IDs in the writing tools and resolves the image places in site_template_read', async () => {
    const { deps } = await setup();
    const tools = Object.fromEntries(moduleMcpTools(deps, siteModule).map((t) => [t.name, t]));
    for (const name of ['site_variables_set', 'site_team_create', 'site_team_update', 'site_stories_update']) expect(tools[name]!.description, name).toMatch(/<assetId>~x_y_w_h/);
    const read = unwrap(await tools.site_template_read!.handler(deps, ctxWith(['site.view']), {})) as { fieldImagePlaces: Record<string, { formats: string[]; places: { minWidthPx: number; label?: string }[] }>; imagePlaces: object };
    expect(Object.keys(read.fieldImagePlaces).sort()).toEqual(['collections.stories.gallery[].image', 'collections.team.photo', 'variables.hero']);
    expect(read.fieldImagePlaces['collections.team.photo']).toMatchObject({ formats: ['1:1'], places: [{ minWidthPx: 480, label: 'Team' }] });
    expect(read.fieldImagePlaces['variables.hero']).toMatchObject({ formats: ['16:9'], places: [{ minWidthPx: 1600, label: 'Bühne' }] });
    expect(read.imagePlaces).toEqual({});
  });
});
