import { setModuleEnabled, unwrap } from '@kompass/core';
import { createAnimal, requestAnimalReview, setAnimalPublished, updateAnimal } from '@kompass/module-animals';
import { createProject, setProjectPublished, updateProject } from '@kompass/module-projects';
import { describe, expect, it } from 'vitest';
import { createEntry, setEntryPublished } from '../src/entries';
import { contentManifestOf, readPublicContent } from '../src/public-content';
import { activeTemplate } from '../src/service';
import { setValues } from '../src/values';
import { admin, setupPublicContent, type SetupDeps } from './public-content-setup';

const itemsOf = (deps: SetupDeps) => unwrap(readPublicContent(deps, activeTemplate(deps)!)).items;
const byKey = (deps: SetupDeps) => contentManifestOf(itemsOf(deps));

describe('readPublicContent', () => {
  it('gives one item per variable, entry and view row, keyed by the record', async () => {
    const deps = await setupPublicContent();
    unwrap(await setValues(deps, admin, { values: { claim: { de: 'Hallo' } } }));
    const note = unwrap(await createEntry(deps, admin, { collection: 'notes', data: { body: 'Notiz' } }));
    const post = unwrap(await createEntry(deps, admin, { collection: 'posts', slug: 'p', data: { title: 'Sommerfest' } }));
    unwrap(await createEntry(deps, admin, { collection: 'posts', slug: 'q', data: { title: 'Entwurf' } }));
    unwrap(await setEntryPublished(deps, admin, { id: post.id, isPublished: true }));
    const dog = unwrap(await createAnimal(deps, admin, { name: 'Bruno', sex: 'male', birthText: {}, sizeText: {}, summary: { de: 'Lieb' }, body: {} }));
    unwrap(await setAnimalPublished(deps, admin, { id: dog.id, isPublished: true }));
    const project = unwrap(await createProject(deps, admin, { slug: 'hof', name: { de: 'Der Hof' }, type: 'ongoing', summary: { de: 'S' }, body: { de: '' } }));
    unwrap(await setProjectPublished(deps, admin, { id: project.id, isPublished: true }));
    const m = byKey(deps);
    expect(m['variables.claim']).toMatchObject({ label: 'Claim', href: '/site/variables' });
    expect(m[`entries.notes.${note.id}`]).toMatchObject({ label: 'Notiz', href: `/site/c/notes/${note.id}` });
    expect(m[`entries.posts.${post.id}`]).toMatchObject({ label: 'Sommerfest', href: `/site/c/posts/${post.id}` });
    expect(Object.keys(m).filter((k) => k.startsWith('entries.posts.'))).toHaveLength(1); // der Entwurf ist nicht veröffentlicht
    expect(m[`views.animals:/animals/${dog.id}`]).toMatchObject({ label: 'Bruno', href: `/animals/${dog.id}` });
    expect(m[`views.projects:/projects/${project.id}`]).toMatchObject({ label: 'Der Hof', href: `/projects/${project.id}` });
    expect(m['views.organization:/admin/settings']).toMatchObject({ href: '/admin/settings' });
    for (const item of Object.values(m)) expect(item.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('hashes the public form only: internal fields and other locales leave it alone', async () => {
    const deps = await setupPublicContent(['de', 'en']);
    const dog = unwrap(await createAnimal(deps, admin, { name: 'Bruno', sex: 'male', birthText: {}, sizeText: {}, summary: { de: 'Lieb' }, body: {} }));
    unwrap(await setAnimalPublished(deps, admin, { id: dog.id, isPublished: true }));
    const key = `views.animals:/animals/${dog.id}`;
    const before = byKey(deps)[key]!.hash;
    unwrap(await requestAnimalReview(deps, admin, { id: dog.id, note: 'bitte prüfen' }));
    unwrap(await updateAnimal(deps, admin, { id: dog.id, summary: { de: 'Lieb', en: 'Kind' } }));
    expect(byKey(deps)[key]!.hash).toBe(before);
    unwrap(await updateAnimal(deps, admin, { id: dog.id, summary: { de: 'Sehr lieb' } }));
    expect(byKey(deps)[key]!.hash).not.toBe(before);
  });

  it('keeps the key of a project whose slug changed', async () => {
    const deps = await setupPublicContent();
    const project = unwrap(await createProject(deps, admin, { slug: 'hof', name: { de: 'Der Hof' }, type: 'ongoing', summary: { de: 'S' }, body: { de: '' } }));
    unwrap(await setProjectPublished(deps, admin, { id: project.id, isPublished: true }));
    unwrap(await updateProject(deps, admin, { id: project.id, slug: 'gnadenhof' }));
    expect(Object.keys(byKey(deps))).toContain(`views.projects:/projects/${project.id}`);
  });

  it('refuses like the export when a used module is switched off', async () => {
    const deps = await setupPublicContent();
    unwrap(await setModuleEnabled(deps, admin, { key: 'animals', enabled: false }));
    expect(readPublicContent(deps, activeTemplate(deps)!)).toMatchObject({ ok: false, error: { type: 'conflict', code: 'moduleDisabled' } });
  });
});
