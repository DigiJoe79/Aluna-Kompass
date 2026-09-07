import { schema as core, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { asset, text } from '@kompass/site-template';
import {
  createEntry,
  deleteEntry,
  getEntry,
  listEntries,
  reorderEntries,
  setEntryPublished,
  updateEntry,
} from '../src/entries';
import type { FieldSchema, TemplateSchema } from '../src/load';
import { siteEntries, siteTemplateState } from '../src/schema';

const asJson = (s: unknown) => z.toJSONSchema(s as z.ZodType, { io: 'input' }) as FieldSchema;

type Cols = TemplateSchema['collections'];

const withUser = (collections: Cols, locales = ['de']) => {
  const deps = createTestDeps({ locales });
  insertUser(deps, { id: 'USER-TEST' });
  deps.db
    .insert(siteTemplateState)
    .values({
      id: 'current',
      name: 'T',
      schemaJson: { name: 'T', locales, uses: [], variables: {}, collections },
      checksum: 'a'.repeat(64),
      readAt: 't',
      readByUserId: null,
    })
    .run();
  return deps;
};

const notes: Cols[string] = { label: 'Notizen', slug: false, sortable: true, publishable: false, fields: { body: asJson(text({ label: 'Text' })) } };
const articles: Cols[string] = { label: 'Artikel', slug: true, sortable: false, publishable: true, fields: { title: asJson(text({ label: 'Titel' })) } };
const gallery: Cols[string] = { label: 'Galerie', slug: false, sortable: false, publishable: false, max: 2, fields: { photo: asJson(asset({ label: 'Foto' })) } };

const manage = ctxWith(['site.manage', 'site.view']);

describe('site entries', () => {
  it('creates an entry against the declared fields and returns it', async () => {
    const deps = withUser({ notes });
    const created = unwrap(await createEntry(deps, manage, { collection: 'notes', data: { body: 'Erste Notiz' } }));
    expect(created.collection).toBe('notes');
    expect((created.data as { body: string }).body).toBe('Erste Notiz');
    expect(created.sortOrder).toBe(0);
    const fetched = unwrap(await getEntry(deps, manage, created.id));
    expect(fetched.id).toBe(created.id);
  });

  it('needs site.manage to write and site.view to read', async () => {
    const deps = withUser({ notes });
    const id = unwrap(await createEntry(deps, manage, { collection: 'notes', data: { body: 'x' } })).id;
    expect((await createEntry(deps, ctxWith(['site.view']), { collection: 'notes', data: {} })).ok).toBe(false);
    expect((await updateEntry(deps, ctxWith(['site.view']), { id, data: {} })).ok).toBe(false);
    expect((await deleteEntry(deps, ctxWith(['site.view']), { id })).ok).toBe(false);
    expect((await listEntries(deps, ctxWith([]), 'notes')).ok).toBe(false);
    expect((await getEntry(deps, ctxWith([]), id)).ok).toBe(false);
  });

  it('refuses an unknown collection', async () => {
    const deps = withUser({ notes });
    const r = await createEntry(deps, manage, { collection: 'ghosts', data: {} });
    expect(r.ok === false && r.error.type === 'notFound').toBe(true);
  });

  it('refuses a duplicate slug inside the same collection but allows it in another', async () => {
    const deps = withUser({ articles, blog: { ...articles, label: 'Blog' } });
    unwrap(await createEntry(deps, manage, { collection: 'articles', slug: 'hallo', data: { title: 'A' } }));
    const dup = await createEntry(deps, manage, { collection: 'articles', slug: 'hallo', data: { title: 'B' } });
    expect(dup.ok === false && dup.error.type === 'conflict' && dup.error.code === 'duplicateSlug').toBe(true);
    unwrap(await createEntry(deps, manage, { collection: 'blog', slug: 'hallo', data: { title: 'C' } }));
  });

  it('refuses a slug where the collection declares none', async () => {
    const deps = withUser({ notes });
    const r = await createEntry(deps, manage, { collection: 'notes', slug: 'nope', data: { body: 'x' } });
    expect(r.ok === false && r.error.type === 'validation' && r.error.issues[0]?.message === 'slugNotAllowed').toBe(true);
  });

  it('refuses the entry beyond max', async () => {
    const deps = withUser({ gallery });
    unwrap(await createEntry(deps, manage, { collection: 'gallery', data: {} }));
    unwrap(await createEntry(deps, manage, { collection: 'gallery', data: {} }));
    const r = await createEntry(deps, manage, { collection: 'gallery', data: {} });
    expect(r.ok === false && r.error.type === 'conflict' && r.error.code === 'tooManyEntries').toBe(true);
  });

  it('refuses publishing where the collection is not publishable', async () => {
    const deps = withUser({ notes });
    const id = unwrap(await createEntry(deps, manage, { collection: 'notes', data: { body: 'x' } })).id;
    const r = await setEntryPublished(deps, manage, { id, isPublished: true });
    expect(r.ok === false && r.error.type === 'conflict' && r.error.code === 'notPublishable').toBe(true);
  });

  it('publishes where the collection allows it', async () => {
    const deps = withUser({ articles });
    const id = unwrap(await createEntry(deps, manage, { collection: 'articles', slug: 'a', data: { title: 'A' } })).id;
    const published = unwrap(await setEntryPublished(deps, manage, { id, isPublished: true }));
    expect(published.isPublished).toBe(true);
  });

  it('deletes an entry and writes an audit entry that keeps what was removed', async () => {
    const deps = withUser({ notes });
    const id = unwrap(await createEntry(deps, manage, { collection: 'notes', data: { body: 'wird gelöscht' } })).id;
    unwrap(await deleteEntry(deps, manage, { id }));
    expect(deps.db.select().from(siteEntries).where(eq(siteEntries.id, id)).get()).toBeUndefined();
    const audit = deps.db.select().from(core.auditLog).all().filter((e) => e.action === 'site.entry.delete').at(-1);
    expect(audit?.action).toBe('site.entry.delete');
    expect(JSON.parse(audit?.before ?? '{}').data).toEqual({ body: 'wird gelöscht' });
  });

  it('reorders within one collection and leaves the others untouched', async () => {
    const deps = withUser({ notes, other: { ...notes, label: 'Anderes' } });
    const a = unwrap(await createEntry(deps, manage, { collection: 'notes', data: { body: 'a' } })).id;
    const b = unwrap(await createEntry(deps, manage, { collection: 'notes', data: { body: 'b' } })).id;
    const c = unwrap(await createEntry(deps, manage, { collection: 'notes', data: { body: 'c' } })).id;
    const otherId = unwrap(await createEntry(deps, manage, { collection: 'other', data: { body: 'x' } })).id;
    const otherBefore = deps.db.select().from(siteEntries).where(eq(siteEntries.id, otherId)).get();

    const reordered = unwrap(await reorderEntries(deps, manage, { collection: 'notes', ids: [c, a, b] }));
    expect(reordered.map((r) => r.id)).toEqual([c, a, b]);
    expect(deps.db.select().from(siteEntries).where(eq(siteEntries.id, otherId)).get()).toEqual(otherBefore);
  });

  it('updates a field and merges it into the stored data', async () => {
    const deps = withUser({ articles });
    const id = unwrap(await createEntry(deps, manage, { collection: 'articles', slug: 'a', data: { title: 'Alt' } })).id;
    const updated = unwrap(await updateEntry(deps, manage, { id, data: { title: 'Neu' } }));
    expect((updated.data as { title: string }).title).toBe('Neu');
  });
});
