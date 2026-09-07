import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setSetting, storeMediaAsset, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { createEntry, setEntryPublished } from '../src/entries';
import { exportSiteContent } from '../src/export';
import { siteValues } from '../src/schema';
import { applyTemplateSync } from '../src/service';
import { setValues } from '../src/values';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const tmp = (prefix: string) => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

const templateDir = (source: string) => {
  const dir = tmp('kompass-exp-tpl-');
  writeFileSync(path.join(dir, 'kompass.template.ts'), source);
  return dir;
};

const GOOD = `
import { defineTemplate, text } from '@kompass/site-template';
export default defineTemplate({
  name: 'X', locales: ['de'],
  variables: { claim: text({ localized: true, label: 'Claim' }) },
  collections: {
    notes: { label: 'Notizen', fields: { body: text({ label: 'Text' }) } },
    posts: { label: 'Beiträge', slug: true, publishable: true, fields: { title: text({ label: 'Titel' }) } },
  },
});`;

const manage = ctxWith(['site.manage', 'site.view']);
const publish = ctxWith(['site.publish']);

const setup = async (source = GOOD, locales = ['de']) => {
  const deps = createTestDeps({ locales });
  insertUser(deps, { id: 'USER-TEST' });
  const dir = templateDir(source);
  unwrap(await applyTemplateSync(deps, ctxWith(['site.manage']), { dir, confirm: true }));
  return { deps, dir };
};

const readContent = async (deps: Awaited<ReturnType<typeof setup>>['deps'], dir: string) => {
  const jobDir = tmp('kompass-exp-job-');
  const result = unwrap(await exportSiteContent(deps, publish, { jobDir, templateDir: dir }));
  return { result, content: JSON.parse(readFileSync(path.join(jobDir, 'content.json'), 'utf8')) };
};

describe('site export', () => {
  it('writes variables, collections and used views into one content.json', async () => {
    const { deps, dir } = await setup();
    unwrap(await setValues(deps, manage, { values: { claim: { de: 'Hallo' } } }));
    unwrap(await createEntry(deps, manage, { collection: 'notes', data: { body: 'Notiz' } }));
    const { content } = await readContent(deps, dir);
    expect(content.variables).toEqual({ claim: { de: 'Hallo' } });
    expect(content.collections.notes).toEqual([{ body: 'Notiz' }]);
    // Ohne `uses` bleiben nur die Sichten des Kerns.
    expect(Object.keys(content.views)).toEqual(['organization']);
    expect(content.assets).toEqual([]);
  });

  it('leaves out entries that are not published where the collection is publishable', async () => {
    const { deps, dir } = await setup();
    const a = unwrap(await createEntry(deps, manage, { collection: 'posts', slug: 'a', data: { title: 'A' } })).id;
    unwrap(await createEntry(deps, manage, { collection: 'posts', slug: 'b', data: { title: 'B' } }));
    unwrap(await setEntryPublished(deps, manage, { id: a, isPublished: true }));
    const { content } = await readContent(deps, dir);
    expect(content.collections.posts).toEqual([{ slug: 'a', title: 'A' }]);
  });

  it('keeps only the locales the installation configured', async () => {
    const { deps, dir } = await setup();
    deps.db.insert(siteValues).values({ key: 'claim', value: { de: 'Hallo', en: 'leftover' }, updatedAt: 't' }).run();
    const { content } = await readContent(deps, dir);
    expect(content.variables.claim).toEqual({ de: 'Hallo' });
  });

  it('reports a used view whose module is disabled instead of writing an empty list', async () => {
    const source = GOOD.replace('collections: {', "uses: ['ghost'],\n  collections: {");
    const { deps, dir } = await setup(source);
    const jobDir = tmp('kompass-exp-job-');
    const result = await exportSiteContent(deps, publish, { jobDir, templateDir: dir });
    expect(result.ok === false && result.error.type === 'conflict' && result.error.code === 'moduleDisabled').toBe(true);
  });

  it('refuses to export while the template file differs from the read state', async () => {
    const { deps, dir } = await setup();
    writeFileSync(path.join(dir, 'kompass.template.ts'), GOOD.replace("name: 'X'", "name: 'X2'"));
    const jobDir = tmp('kompass-exp-job-');
    const result = await exportSiteContent(deps, publish, { jobDir, templateDir: dir });
    expect(result.ok === false && result.error.type === 'conflict' && result.error.code === 'templateStale').toBe(true);
  });

  /**
   * Assets wurden am Feldnamen erkannt (`/assetid$/i`) — ein Erbe des alten
   * Moduls, wo sie fest `photoAssetId` hiessen. Im Template wählt der Autor den
   * Namen; erkennbar ist ein Asset nur an seiner Markierung im Schema.
   */
  it('collects assets from fields whatever they are called', async () => {
    const source = `
import { defineTemplate, asset, text } from '@kompass/site-template';
export default defineTemplate({
  name: 'X', locales: ['de'],
  variables: { heroImage: asset({ label: 'Titelbild' }) },
  collections: {
    team: { label: 'Team', fields: { name: text({ label: 'Name' }), photo: asset({ label: 'Foto' }) } },
  },
});`;
    const { deps, dir } = await setup(source);
    const manage = ctxWith(['site.manage', 'site.view', 'media.upload']);
    // 1x1-PNG, damit die Assets echte Medien-Datensätze haben.
    const png = (seed: string) =>
      Buffer.from(`iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42m${seed}kYAAAAASUVORK5CYII=`, 'base64');
    const hero = unwrap(await storeMediaAsset(deps, manage, { originalName: 'hero.png', bytes: png('P8z8BQDwAF') }));
    const photo = unwrap(await storeMediaAsset(deps, manage, { originalName: 'photo.png', bytes: png('P8/x8AAwMB') }));

    unwrap(await setValues(deps, manage, { values: { heroImage: hero.id } }));
    unwrap(await createEntry(deps, manage, { collection: 'team', data: { name: 'Anna', photo: photo.id } }));

    const { content } = await readContent(deps, dir);
    expect((content as { assets: { id: string }[] }).assets.map((a) => a.id).sort()).toEqual([hero.id, photo.id].sort());
  });

  /** Stammdaten pflegt ein Verein einmal in den Einstellungen — kein Template
   *  soll sie als eigene Variablen verdoppeln müssen. */
  it('always ships the organization view, without the template asking for it', async () => {
    const { deps, dir } = await setup();
    unwrap(await setSetting(deps, ctxWith(['settings.manage']), { key: 'organization.city', value: 'Jülich' }));
    const { content } = await readContent(deps, dir);
    const views = (content as { views: Record<string, { city: string }[]> }).views;
    expect(views.organization?.[0]?.city).toBe('Jülich');
  });
});
