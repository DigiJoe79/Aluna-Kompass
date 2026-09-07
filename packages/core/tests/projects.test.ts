import { describe, expect, it } from 'vitest';
import { auditLog } from '../src/db/schema';
import { createProject, getProject, listProjects, reorderProjects, setProjectPublished, updateProject } from '../src/projects/service';
import { unwrap } from '../src/result';
import { setSetting } from '../src/settings/service';
import { createTestDeps, ctxWith, insertUser } from '../src/testing';

const manage = () => ctxWith(['website.manage', 'website.view']);
const base = { slug: 'grundversorgung', name: { de: 'Grundversorgung des Shelters', en: '' }, type: 'ongoing' as const, summary: { de: 'Futter und Wärme', en: 'Food and warmth' }, body: { de: 'Text', en: '' }, betterplaceProjectId: '000001' };

const setup = async () => {
  const deps = createTestDeps();
  insertUser(deps, { id: 'USER-TEST' });
  await setSetting(deps, ctxWith(['settings.manage']), { key: 'i18n.locales', value: ['de', 'en'] });
  return deps;
};

describe('projects service', () => {
  it('creates a project unpublished with audit and sort order at the end', async () => {
    const deps = await setup();
    const a = unwrap(await createProject(deps, manage(), base));
    const b = unwrap(await createProject(deps, manage(), { ...base, slug: 'op-fonds', type: 'shortTerm' as const }));
    expect(a).toMatchObject({ slug: 'grundversorgung', isPublished: false, sortOrder: 1, status: 'active', name: { de: 'Grundversorgung des Shelters', en: '' } });
    expect(b.sortOrder).toBe(2);
    expect(deps.db.select().from(auditLog).all().at(-1)).toMatchObject({ action: 'projects.create', entityType: 'project', entityId: b.id });
  });

  it('rejects duplicate and invalid slugs, missing permission', async () => {
    const deps = await setup();
    unwrap(await createProject(deps, manage(), base));
    const dup = await createProject(deps, manage(), base);
    expect(dup.ok === false && dup.error.type === 'conflict' && dup.error.code === 'slugTaken').toBe(true);
    const bad = await createProject(deps, manage(), { ...base, slug: 'Grund Versorgung' });
    expect(bad.ok === false && bad.error.type === 'validation').toBe(true);
    const denied = await createProject(deps, ctxWith(['website.view']), { ...base, slug: 'x' });
    expect(denied.ok === false && denied.error.type === 'forbidden').toBe(true);
  });

  it('updates fields, toggles publication and reorders', async () => {
    const deps = await setup();
    const a = unwrap(await createProject(deps, manage(), base));
    const b = unwrap(await createProject(deps, manage(), { ...base, slug: 'b' }));
    const updated = unwrap(await updateProject(deps, manage(), { id: a.id, name: { de: 'Neu', en: 'New' }, status: 'completed' }));
    expect(updated).toMatchObject({ name: { de: 'Neu', en: 'New' }, status: 'completed', slug: 'grundversorgung' });
    expect(unwrap(await setProjectPublished(deps, manage(), { id: a.id, isPublished: true })).isPublished).toBe(true);
    unwrap(await reorderProjects(deps, manage(), { ids: [b.id, a.id] }));
    expect(unwrap(await listProjects(deps, ctxWith(['website.view']))).map((p) => p.slug)).toEqual(['b', 'grundversorgung']);
    expect(unwrap(await getProject(deps, ctxWith(['website.view']), a.id)).sortOrder).toBe(2);
    expect((await listProjects(deps, ctxWith([]))).ok).toBe(false);
  });
});
