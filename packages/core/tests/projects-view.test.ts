import { describe, expect, it } from 'vitest';
import { coreModule, createProject, publishedProjects, setProjectPublished, unwrap } from '../src';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';

const setup = async () => {
  const deps = createTestDeps({ manifests: [coreModule] });
  insertUser(deps, { id: 'USER-TEST' });
  const ctx = ctxWith(['projects.manage', 'projects.view']);
  const a = unwrap(await createProject(deps, ctx, { slug: 'hof', name: { de: 'Der Hof' }, type: 'ongoing', summary: { de: 'kurz' }, body: { de: 'lang' } }));
  unwrap(await createProject(deps, ctx, { slug: 'still', name: { de: 'Stiller' }, type: 'shortTerm', summary: { de: '' }, body: { de: '' } }));
  unwrap(await setProjectPublished(deps, ctx, { id: a.id, isPublished: true }));
  return deps;
};

describe('published projects view', () => {
  it('belongs to the core module, where the table already lives', () => {
    expect(coreModule.publishedViews?.some((v) => v.name === 'projects')).toBe(true);
  });

  it('shows only published projects', async () => {
    const deps = await setup();
    const rows = publishedProjects.load(deps) as { slug: string }[];
    expect(rows.map((r) => r.slug)).toEqual(['hof']);
  });

  it('leaves internal fields out of the published shape', async () => {
    const deps = await setup();
    const [row] = publishedProjects.load(deps) as Record<string, unknown>[];
    expect(row).toHaveProperty('summary');
    for (const internal of ['isPublished', 'createdAt', 'updatedAt', 'id']) {
      expect(row, `${internal} gehört nicht in die veröffentlichte Sicht`).not.toHaveProperty(internal);
    }
  });
});
