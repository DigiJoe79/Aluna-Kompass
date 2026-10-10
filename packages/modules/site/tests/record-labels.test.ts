import { coreModule, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { asset, text } from '@kompass/site-template';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createEntry } from '../src/entries';
import type { FieldSchema, TemplateSchema } from '../src/load';
import { siteModule } from '../src/manifest';
import { siteRecordLabels } from '../src/record-labels';
import { siteTemplateState } from '../src/schema';

const asJson = (s: unknown) => z.toJSONSchema(s as z.ZodType, { io: 'input' }) as FieldSchema;
const collections: TemplateSchema['collections'] = {
  articles: { label: 'Artikel', slug: true, sortable: false, publishable: true, fields: { title: asJson(text({ label: 'Titel' })) } },
  gallery: { label: 'Galerie', slug: false, sortable: false, publishable: false, fields: { photo: asJson(asset({ label: 'Foto' })) } },
};

function setup() {
  const deps = createTestDeps({ locales: ['de'], manifests: [coreModule, siteModule] });
  insertUser(deps, { id: 'USER-TEST' });
  deps.db.insert(siteTemplateState).values({ id: 'current', name: 'T', schemaJson: { name: 'T', locales: ['de'], uses: [], variables: {}, collections }, checksum: 'a'.repeat(64), readAt: 't', readByUserId: null }).run();
  return deps;
}

/** Ein Eintrag der Webseite heißt im Protokoll nach seinem Titel in der Standardsprache (Joe 2026-10-09). */
describe('siteRecordLabels', () => {
  it('nennt den Titel, ohne Titel keinen Namen, und Gelöschtes als missing', async () => {
    const deps = setup();
    const manage = ctxWith(['site.manage', 'site.view']);
    const article = unwrap(await createEntry(deps, manage, { collection: 'articles', slug: 'sommerfest', data: { title: 'Sommerfest 2026' } }));
    const photo = unwrap(await createEntry(deps, manage, { collection: 'gallery', data: {} }));
    expect(siteRecordLabels(deps, ctxWith(['site.view']), 'siteEntry', article.id)).toEqual({ label: 'Sommerfest 2026', href: `/site/c/articles/${article.id}`, state: 'ok' });
    // Ohne Titel und Slug wäre die Beschriftung der Liste die ID — die gehört nicht in die Spalte.
    expect(siteRecordLabels(deps, ctxWith(['site.view']), 'siteEntry', photo.id)).toEqual({ label: '', href: `/site/c/gallery/${photo.id}`, state: 'ok' });
    expect(siteRecordLabels(deps, ctxWith([]), 'siteEntry', article.id)).toMatchObject({ state: 'forbidden', href: null });
    expect(siteRecordLabels(deps, ctxWith(['site.view']), 'siteEntry', 'WEG')).toEqual({ label: '', href: null, state: 'missing' });
    expect(siteRecordLabels(deps, ctxWith(['site.view']), 'animal', 'A1')).toBeNull();
  });

  /** Die Sammlung heißt im Protokoll wie in der Oberfläche (Designer 2026-10-09). */
  it('nennt eine Sammlung mit ihrer Beschriftung', () => {
    const deps = setup();
    expect(siteRecordLabels(deps, ctxWith(['site.view']), 'siteCollection', 'articles')).toEqual({ label: 'Artikel', href: '/site/c/articles', state: 'ok' });
    expect(siteRecordLabels(deps, ctxWith(['site.view']), 'siteCollection', 'weg')).toEqual({ label: '', href: null, state: 'missing' });
    expect(siteRecordLabels(deps, ctxWith([]), 'siteCollection', 'articles')).toMatchObject({ state: 'forbidden' });
  });
});
