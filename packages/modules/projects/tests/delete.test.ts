import { coreModule, defineModule, schema, setSetting, storeMediaAsset, unwrap, writeSettingInternal, type Deps } from '@kompass/core';
import { auditEntry, createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { projectsModule } from '../src/manifest';
import { projects } from '../src/schema';
import { createProject, deleteProject, projectDeletionPreview, setProjectPublished } from '../src/service';

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));

const deleted: string[] = [];
const slugOf = (deps: Deps, id: string) => deps.db.select().from(projects).where(eq(projects.id, id)).get()?.slug;
const probe = defineModule({
  key: 'probe',
  version: '0.0.0',
  permissions: [],
  retentionHolds: (deps, entityType, id) => (entityType === 'project' && slugOf(deps, id) === 'gehalten' ? [{ label: 'Zuwendungsbescheid ZB-2026-0003', until: null, entity: 'document', id: 'D1' }] : []),
  recordReferences: (deps, entityType, id) => (entityType === 'project' && slugOf(deps, id) === 'verwiesen' ? [{ label: 'Wiedervorlage „Partner anrufen“', entity: 'followUp', id: 'F1' }] : []),
  recordDeleted: (_tx, _deps, _ctx, entityType, id) => void deleted.push(`${entityType}:${id}`),
});

const manage = ctxWith(['projects.manage', 'projects.view', 'media.upload']);
const base = { name: { de: 'Kastrationsaktion des Partnervereins' }, type: 'shortTerm' as const, summary: { de: 'Nur ein Verweis.' }, body: { de: '' }, externalLinks: [{ label: 'Zur Aktion', url: 'https://partner.example.org/aktion' }] };

async function setup() {
  const deps = createTestDeps({ manifests: [coreModule, projectsModule, probe], now: '2026-09-17T08:00:00.000Z' });
  insertUser(deps, { id: 'USER-TEST' });
  await setSetting(deps, ctxWith(['settings.manage']), { key: 'i18n.locales', value: ['de'] });
  deps.db.transaction((tx) => {
    writeSettingInternal(tx, deps, ctxWith(['settings.manage']), 'modules.enabled', ['projects', 'probe'], 'test.enable');
  });
  return deps;
}
const code = (r: { ok: boolean; error?: { type: string; code?: string } }) => (r.ok ? 'ok' : r.error!.type === 'conflict' ? r.error!.code : r.error!.type);

describe('deleteProject', () => {
  it('löscht ein Verweis-Projekt erst nach dem Zurückziehen und protokolliert das Vorher', async () => {
    const deps = await setup();
    const p = unwrap(await createProject(deps, manage, { ...base, slug: 'kastration' }));
    unwrap(await setProjectPublished(deps, manage, { id: p.id, isPublished: true }));
    expect(code(await deleteProject(deps, manage, { id: p.id }))).toBe('stillPublished');
    unwrap(await setProjectPublished(deps, manage, { id: p.id, isPublished: false }));

    expect(unwrap(await deleteProject(deps, manage, { id: p.id }))).toEqual({ deletedMedia: [], keptMedia: [] });
    expect(deps.db.select().from(projects).all()).toEqual([]);
    const entry = auditEntry(deps, 'projects.delete');
    expect(entry).toMatchObject({ entityType: 'project', entityId: p.id, summary: 'Projekt kastration gelöscht' });
    expect(JSON.parse(entry.before!)).toMatchObject({ slug: 'kastration', externalLinks: base.externalLinks });
  });

  it('lehnt ab, solange ein Halter läuft oder ein Verweis besteht', async () => {
    const deps = await setup();
    const held = unwrap(await createProject(deps, manage, { ...base, slug: 'gehalten' }));
    const linked = unwrap(await createProject(deps, manage, { ...base, slug: 'verwiesen' }));
    const heldResult = await deleteProject(deps, manage, { id: held.id });
    expect(code(heldResult)).toBe('recordHeld');
    expect(heldResult.ok === false && heldResult.error.type === 'conflict' && heldResult.error.message).toContain('ZB-2026-0003 (dauerhaft)');
    expect(code(await deleteProject(deps, manage, { id: linked.id }))).toBe('stillReferenced');
    expect(unwrap(await projectDeletionPreview(deps, manage, linked.id))).toMatchObject({ deletable: false, references: [{ entity: 'followUp', id: 'F1' }] });
    expect(deps.db.select().from(projects).all()).toHaveLength(2);
  });

  it('räumt mit Schalter das nur hier verwendete Titelbild ab, ohne Schalter bleibt es', async () => {
    const deps = await setup();
    const image = unwrap(await storeMediaAsset(deps, manage, { originalName: 'aktion.png', bytes: PNG }));
    const keep = unwrap(await createProject(deps, manage, { ...base, slug: 'bleibt', imageAssetId: image.id }));
    unwrap(await deleteProject(deps, manage, { id: keep.id }));
    expect(deps.db.select().from(schema.mediaAssets).all()).toHaveLength(1);

    const p = unwrap(await createProject(deps, manage, { ...base, slug: 'geht', imageAssetId: image.id }));
    expect(unwrap(await projectDeletionPreview(deps, manage, p.id)).media).toEqual([{ id: image.id, filename: image.filename, usedElsewhere: [] }]);
    expect(unwrap(await deleteProject(deps, manage, { id: p.id, deleteOrphanedMedia: true }))).toEqual({ deletedMedia: [image.id], keptMedia: [] });
    expect(await deps.media.exists(image.filename)).toBe(false);
  });

  it('verlangt projects.manage, und für den Schalter media.upload — vorher passiert nichts', async () => {
    const deps = await setup();
    const p = unwrap(await createProject(deps, manage, { ...base, slug: 'kastration' }));
    expect(code(await deleteProject(deps, ctxWith(['projects.view']), { id: p.id }))).toBe('forbidden');
    expect(code(await deleteProject(deps, ctxWith(['projects.manage']), { id: p.id, deleteOrphanedMedia: true }))).toBe('forbidden');
    expect(deps.db.select().from(projects).all()).toHaveLength(1);
    expect(code(await deleteProject(deps, manage, { id: 'MISSING' }))).toBe('notFound');
    expect(code(await projectDeletionPreview(deps, ctxWith([]), p.id))).toBe('forbidden');
  });

  it('sagt den anderen Modulen, dass das Projekt weg ist', async () => {
    const deps = await setup();
    const p = unwrap(await createProject(deps, manage, { ...base, slug: 'weg' }));
    deleted.length = 0;
    expect(code(await deleteProject(deps, manage, { id: p.id }))).toBe('ok');
    expect(deleted).toEqual([`project:${p.id}`]);
  });
});
