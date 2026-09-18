import { coreModule, storeMediaAsset, unwrap, writeSettingInternal } from '@kompass/core';
import { auditEntry, createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { asset, text } from '@kompass/site-template';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createEntry, deleteEntry, entryDeletionPreview, setEntryPublished } from '../src/entries';
import type { FieldSchema, TemplateSchema } from '../src/load';
import { siteModule } from '../src/manifest';
import { siteEntries, siteTemplateState } from '../src/schema';

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
const asJson = (s: unknown) => z.toJSONSchema(s as z.ZodType, { io: 'input' }) as FieldSchema;
type Cols = TemplateSchema['collections'];

const articles: Cols[string] = { label: 'Artikel', slug: true, sortable: false, publishable: true, fields: { title: asJson(text({ label: 'Titel' })), image: asJson(asset({ label: 'Bild' })) } };
const notes: Cols[string] = { label: 'Notizen', slug: false, sortable: true, publishable: false, fields: { body: asJson(text({ label: 'Text' })) } };

const manage = ctxWith(['site.manage', 'site.view', 'media.upload']);
const code = (r: { ok: boolean; error?: { type: string; code?: string } }) => (r.ok ? 'ok' : r.error!.type === 'conflict' ? r.error!.code : r.error!.type);

function setup() {
  const deps = createTestDeps({ manifests: [coreModule, siteModule], locales: ['de'] });
  insertUser(deps, { id: 'USER-TEST' });
  deps.db
    .insert(siteTemplateState)
    .values({ id: 'current', name: 'T', schemaJson: { name: 'T', locales: ['de'], uses: [], variables: {}, collections: { articles, notes } }, checksum: 'a'.repeat(64), readAt: 't', readByUserId: null })
    .run();
  deps.db.transaction((tx) => {
    writeSettingInternal(tx, deps, ctxWith(['settings.manage']), 'modules.enabled', ['site'], 'test.enable');
  });
  return deps;
}

describe('deleteEntry in zwei Stufen', () => {
  it('lehnt einen veröffentlichten Eintrag ab und löscht ihn nach dem Zurückziehen', async () => {
    const deps = setup();
    const e = unwrap(await createEntry(deps, manage, { collection: 'articles', slug: 'sommerfest', data: { title: 'Sommerfest' } }));
    unwrap(await setEntryPublished(deps, manage, { id: e.id, isPublished: true }));
    expect(code(await deleteEntry(deps, manage, { id: e.id }))).toBe('stillPublished');
    expect(unwrap(await entryDeletionPreview(deps, manage, e.id))).toMatchObject({ isPublished: true, deletable: false });

    unwrap(await setEntryPublished(deps, manage, { id: e.id, isPublished: false }));
    expect(unwrap(await deleteEntry(deps, manage, { id: e.id }))).toEqual({ deletedMedia: [], keptMedia: [] });
    expect(deps.db.select().from(siteEntries).all()).toEqual([]);
    expect(auditEntry(deps, 'site.entry.delete')).toMatchObject({ entityType: 'siteEntry', entityId: e.id });
  });

  it('löscht in einer Sammlung ohne Veröffentlicht-Schalter direkt', async () => {
    const deps = setup();
    const n = unwrap(await createEntry(deps, manage, { collection: 'notes', data: { body: 'x' } }));
    expect(unwrap(await entryDeletionPreview(deps, manage, n.id))).toMatchObject({ isPublished: false, deletable: true });
    expect((await deleteEntry(deps, manage, { id: n.id })).ok).toBe(true);
  });

  it('räumt mit Schalter das nur hier verwendete Bild ab und behält ein geteiltes', async () => {
    const deps = setup();
    const own = unwrap(await storeMediaAsset(deps, manage, { originalName: 'fest.png', bytes: PNG }));
    const shared = unwrap(await storeMediaAsset(deps, manage, { originalName: 'beide.png', bytes: new Uint8Array([...PNG, 0]) }));
    const a = unwrap(await createEntry(deps, manage, { collection: 'articles', slug: 'a', data: { title: 'A', image: own.id } }));
    const b = unwrap(await createEntry(deps, manage, { collection: 'articles', slug: 'b', data: { title: 'B', image: shared.id } }));
    unwrap(await createEntry(deps, manage, { collection: 'articles', slug: 'c', data: { title: 'C', image: shared.id } }));

    expect(unwrap(await entryDeletionPreview(deps, manage, a.id)).media).toEqual([{ id: own.id, filename: own.filename, usedElsewhere: [] }]);
    expect(unwrap(await deleteEntry(deps, manage, { id: a.id, deleteOrphanedMedia: true }))).toEqual({ deletedMedia: [own.id], keptMedia: [] });
    expect(await deps.media.exists(own.filename)).toBe(false);

    const kept = unwrap(await deleteEntry(deps, manage, { id: b.id, deleteOrphanedMedia: true }));
    expect(kept.deletedMedia).toEqual([]);
    expect(kept.keptMedia).toHaveLength(1);
    expect(kept.keptMedia[0]!.usedBy[0]).toContain('Eintrag „c“');
    expect(await deps.media.exists(shared.filename)).toBe(true);
  });

  it('verlangt für den Schalter media.upload — vorher passiert nichts', async () => {
    const deps = setup();
    const n = unwrap(await createEntry(deps, manage, { collection: 'notes', data: { body: 'x' } }));
    expect(code(await deleteEntry(deps, ctxWith(['site.manage']), { id: n.id, deleteOrphanedMedia: true }))).toBe('forbidden');
    expect(deps.db.select().from(siteEntries).all()).toHaveLength(1);
    expect(code(await entryDeletionPreview(deps, ctxWith([]), n.id))).toBe('forbidden');
  });
});
