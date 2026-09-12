import { coreModule, schema as core, setSetting, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { projectsModule } from '../src/manifest';
import { createProject, getProject, listProjects, reorderProjects, setProjectPublished, updateProject } from '../src/service';

const manage = () => ctxWith(['projects.manage', 'projects.view']);
const base = { slug: 'grundversorgung', name: { de: 'Grundversorgung des Heims', en: '' }, type: 'ongoing' as const, summary: { de: 'Futter und Wärme', en: 'Food and warmth' }, body: { de: 'Text', en: '' } };

const setup = async () => {
  const deps = createTestDeps({ manifests: [coreModule, projectsModule] });
  insertUser(deps, { id: 'USER-TEST' });
  await setSetting(deps, ctxWith(['settings.manage']), { key: 'i18n.locales', value: ['de', 'en'] });
  return deps;
};

describe('projects service', () => {
  it('creates a project unpublished with audit and sort order at the end', async () => {
    const deps = await setup();
    const a = unwrap(await createProject(deps, manage(), base));
    const b = unwrap(await createProject(deps, manage(), { ...base, slug: 'op-fonds', type: 'shortTerm' as const }));
    expect(a).toMatchObject({ slug: 'grundversorgung', isPublished: false, sortOrder: 1, status: 'active', name: { de: 'Grundversorgung des Heims', en: '' }, externalLinks: [] });
    expect(b.sortOrder).toBe(2);
    expect(deps.db.select().from(core.auditLog).all().at(-1)).toMatchObject({ action: 'projects.create', entityType: 'project', entityId: b.id });
  });

  it('rejects duplicate and invalid slugs, missing permission', async () => {
    const deps = await setup();
    unwrap(await createProject(deps, manage(), base));
    const dup = await createProject(deps, manage(), base);
    expect(dup.ok === false && dup.error.type === 'conflict' && dup.error.code === 'slugTaken').toBe(true);
    const bad = await createProject(deps, manage(), { ...base, slug: 'Grund Versorgung' });
    expect(bad.ok === false && bad.error.type === 'validation').toBe(true);
    const denied = await createProject(deps, ctxWith(['projects.view']), { ...base, slug: 'x' });
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
    expect(unwrap(await listProjects(deps, ctxWith(['projects.view']))).map((p) => p.slug)).toEqual(['b', 'grundversorgung']);
    expect(unwrap(await getProject(deps, ctxWith(['projects.view']), a.id)).sortOrder).toBe(2);
    expect((await listProjects(deps, ctxWith([]))).ok).toBe(false);
  });

  /**
   * Eine Spendenplattform gehört nicht in den generischen Kern (Prinzip 1).
   * Statt der Spalte einer Plattform trägt ein Projekt beliebige Verweise nach
   * aussen — Bezeichnung und Adresse —, und was ein Template daraus macht,
   * entscheidet das Template.
   */
  it('keeps external links as label and url, checked and capped', async () => {
    const deps = await setup();
    const links = [
      { label: 'Spendenplattform', url: 'https://spenden.example.org/projects/000001' },
      { label: 'Bericht', url: 'https://example.org/bericht.pdf' },
    ];
    const created = unwrap(await createProject(deps, manage(), { ...base, externalLinks: links }));
    expect(created.externalLinks).toEqual(links);
    const updated = unwrap(await updateProject(deps, manage(), { id: created.id, externalLinks: [links[1]!] }));
    expect(updated.externalLinks).toEqual([links[1]]);

    const noScheme = await updateProject(deps, manage(), { id: created.id, externalLinks: [{ label: 'x', url: 'spenden.example.org/p/1' }] });
    expect(noScheme.ok === false && noScheme.error.type === 'validation').toBe(true);
    const script = await updateProject(deps, manage(), { id: created.id, externalLinks: [{ label: 'x', url: 'javascript:alert(1)' }] });
    expect(script.ok === false && script.error.type === 'validation').toBe(true);
    const unnamed = await updateProject(deps, manage(), { id: created.id, externalLinks: [{ label: '', url: 'https://example.org' }] });
    expect(unnamed.ok === false && unnamed.error.type === 'validation').toBe(true);
    const tooMany = await updateProject(deps, manage(), { id: created.id, externalLinks: Array.from({ length: 11 }, (_, i) => ({ label: `L${i}`, url: `https://example.org/${i}` })) });
    expect(tooMany.ok === false && tooMany.error.type === 'validation').toBe(true);
  });
});
