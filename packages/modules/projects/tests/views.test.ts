import { coreModule, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { projectsModule } from '../src/manifest';
import { createProject, setProjectPublished } from '../src/service';
import { publishedProjects } from '../src/views';

const setup = async () => {
  const deps = createTestDeps({ manifests: [coreModule, projectsModule] });
  insertUser(deps, { id: 'USER-TEST' });
  const ctx = ctxWith(['projects.manage', 'projects.view']);
  const a = unwrap(await createProject(deps, ctx, { slug: 'hof', name: { de: 'Der Hof' }, type: 'ongoing', summary: { de: 'kurz' }, body: { de: 'lang' }, externalLinks: [{ label: 'Spenden', url: 'https://example.org/spenden' }] }));
  unwrap(await createProject(deps, ctx, { slug: 'still', name: { de: 'Stiller' }, type: 'shortTerm', summary: { de: '' }, body: { de: '' } }));
  unwrap(await setProjectPublished(deps, ctx, { id: a.id, isPublished: true }));
  return deps;
};

describe('published projects view', () => {
  it('belongs to the projects module, not the core', () => {
    expect(projectsModule.publishedViews?.some((v) => v.name === 'projects')).toBe(true);
    expect(coreModule.publishedViews?.some((v) => v.name === 'projects')).toBe(false);
  });

  it('shows only published projects, with their external links', async () => {
    const deps = await setup();
    const rows = publishedProjects.load(deps) as { slug: string; externalLinks: unknown }[];
    expect(rows.map((r) => r.slug)).toEqual(['hof']);
    expect(rows[0]!.externalLinks).toEqual([{ label: 'Spenden', url: 'https://example.org/spenden' }]);
  });

  it('leaves internal fields and any platform id out of the published shape', async () => {
    const deps = await setup();
    const [row] = publishedProjects.load(deps) as Record<string, unknown>[];
    expect(row).toHaveProperty('summary');
    // Die frühere Plattform-ID ist weg; Verweise nach aussen sind die einzige Adresse.
    expect(Object.keys(row!).filter((k) => /projectid$/i.test(k))).toEqual([]);
    for (const internal of ['isPublished', 'createdAt', 'updatedAt', 'id']) {
      expect(row, `${internal} gehört nicht in die veröffentlichte Sicht`).not.toHaveProperty(internal);
    }
  });
});
