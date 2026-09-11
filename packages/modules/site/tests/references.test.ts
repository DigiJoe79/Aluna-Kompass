import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { coreModule, storeMediaAsset, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { createEntry } from '../src/entries';
import { siteModule } from '../src/manifest';
import { siteMediaReferences } from '../src/references';
import { applyTemplateSync } from '../src/service';
import { setValues } from '../src/values';

const PNG = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'),
);

const SOURCE = `
import { defineTemplate, asset, text } from '@kompass/site-template';
export default defineTemplate({
  name: 'X', locales: ['de'],
  variables: { heroImage: asset({ label: 'Titelbild' }) },
  collections: {
    news: { label: 'News', slug: true, fields: { title: text({ localized: true }), image: asset({ label: 'Bild' }) } },
  },
});`;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const setup = async () => {
  const deps = createTestDeps({ locales: ['de'], manifests: [coreModule, siteModule] });
  insertUser(deps, { id: 'USER-TEST' });
  const dir = mkdtempSync(path.join(tmpdir(), 'kompass-ref-tpl-'));
  dirs.push(dir);
  writeFileSync(path.join(dir, 'kompass.template.ts'), SOURCE);
  unwrap(await applyTemplateSync(deps, ctxWith(['site.manage']), { dir, confirm: true }));
  return deps;
};

describe('siteMediaReferences', () => {
  it('finds an asset in a variable and in a collection entry, with readable labels', async () => {
    const deps = await setup();
    const ctx = ctxWith(['media.upload', 'site.manage', 'site.view']);
    const a = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'hero.png', bytes: PNG }));
    unwrap(await setValues(deps, ctx, { values: { heroImage: a.id } }));
    unwrap(await createEntry(deps, ctx, { collection: 'news', slug: 'fest', data: { title: { de: 'Fest' }, image: a.id } }));

    const hits = siteMediaReferences(deps, a.id);
    expect(hits.map((h) => h.label).sort()).toEqual(['Eintrag „fest“ in „News“', 'Variable „heroImage“']);
    expect(siteMediaReferences(deps, 'OTHER')).toEqual([]);
  });
});
