import { setModuleEnabled, unwrap } from '@kompass/core';
import { createAnimal, deleteAnimal, requestAnimalReview, setAnimalPublished, updateAnimal } from '@kompass/module-animals';
import { createProject, deleteProject, setProjectPublished, updateProject } from '@kompass/module-projects';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { createEntry, setEntryPublished, updateEntry } from '../src/entries';
import { computePendingChanges, currentContentManifest, sitePendingChanges } from '../src/pending';
import { recordPublish } from '../src/services/publishes';
import { setValues } from '../src/values';
import { admin, setupPublicContent, type SetupDeps } from './public-content-setup';

const none = { changed: [], added: [], removed: [] };
let day = 0;
/** Ein Publish wie ihn die Pipeline einträgt; `manifest: false` = ein Publish von vor Plan C. */
const stamp = (deps: SetupDeps, opts: { environment?: string; status?: 'success' | 'failed'; manifest?: boolean } = {}) =>
  recordPublish(deps, admin, {
    environment: opts.environment ?? 'production',
    startedAt: `2026-10-${String(++day).padStart(2, '0')}T08:00:00.000Z`,
    status: opts.status ?? 'success',
    contentHash: 'h', diff: none, fileManifest: {}, log: '', summary: 's',
    contentManifest: opts.manifest === false ? null : currentContentManifest(deps),
  });
const dogOf = async (deps: SetupDeps, name: string, published = true) => {
  const dog = unwrap(await createAnimal(deps, admin, { name, sex: 'male', birthText: {}, sizeText: {}, summary: { de: 'Lieb' }, body: {} }));
  if (published) unwrap(await setAnimalPublished(deps, admin, { id: dog.id, isPublished: true }));
  return dog;
};

describe('computePendingChanges', () => {
  it('reports nothing before a publish with a recorded public state', async () => {
    const deps = await setupPublicContent();
    expect(computePendingChanges(deps)).toEqual({ since: null, count: 0, items: [] });
    await dogOf(deps, 'Bruno');
    stamp(deps, { manifest: false });
    await dogOf(deps, 'Kira');
    expect(computePendingChanges(deps)).toEqual({ since: null, count: 0, items: [] });
  });

  it('counts a changed public field, not an internal one or an unpublished record', async () => {
    const deps = await setupPublicContent();
    const bruno = await dogOf(deps, 'Bruno');
    const p = stamp(deps);
    unwrap(await requestAnimalReview(deps, admin, { id: bruno.id, note: 'bitte prüfen' }));
    const kira = await dogOf(deps, 'Kira', false);
    unwrap(await updateAnimal(deps, admin, { id: kira.id, summary: { de: 'Neu' } }));
    expect(computePendingChanges(deps)?.count).toBe(0);
    unwrap(await updateAnimal(deps, admin, { id: bruno.id, summary: { de: 'Sehr lieb' } }));
    expect(computePendingChanges(deps)).toEqual({
      since: p.startedAt,
      count: 1,
      items: [{ key: `views.animals:/animals/${bruno.id}`, kind: 'changed', label: 'Bruno', href: `/animals/${bruno.id}`, recordHref: `/animals/${bruno.id}` }],
    });
  });

  it('names added and removed records; a removed record keeps the name it had, without a link (it may be gone)', async () => {
    const deps = await setupPublicContent();
    const project = unwrap(await createProject(deps, admin, { slug: 'hof', name: { de: 'Der Hof' }, type: 'ongoing', summary: { de: 'S' }, body: { de: '' } }));
    unwrap(await setProjectPublished(deps, admin, { id: project.id, isPublished: true }));
    stamp(deps);
    const nala = await dogOf(deps, 'Nala');
    unwrap(await setProjectPublished(deps, admin, { id: project.id, isPublished: false }));
    unwrap(await deleteProject(deps, admin, { id: project.id }));
    expect(computePendingChanges(deps)?.items.map(({ kind, label, href, recordHref }) => ({ kind, label, href, recordHref }))).toEqual([
      { kind: 'removed', label: 'Der Hof', href: null, recordHref: `/projects/${project.id}` },
      { kind: 'added', label: 'Nala', href: `/animals/${nala.id}`, recordHref: `/animals/${nala.id}` },
    ]);
  });

  it('keeps a project whose slug changed as one change', async () => {
    const deps = await setupPublicContent();
    const project = unwrap(await createProject(deps, admin, { slug: 'hof', name: { de: 'Der Hof' }, type: 'ongoing', summary: { de: 'S' }, body: { de: '' } }));
    unwrap(await setProjectPublished(deps, admin, { id: project.id, isPublished: true }));
    stamp(deps);
    unwrap(await updateProject(deps, admin, { id: project.id, slug: 'gnadenhof' }));
    expect(computePendingChanges(deps)?.items).toEqual([expect.objectContaining({ kind: 'changed', label: 'Der Hof' })]);
  });

  it('counts variables and entries of the template', async () => {
    const deps = await setupPublicContent();
    const draft = unwrap(await createEntry(deps, admin, { collection: 'posts', slug: 'd', data: { title: 'Entwurf' } }));
    stamp(deps);
    unwrap(await setValues(deps, admin, { values: { claim: { de: 'Neu' } } }));
    unwrap(await updateEntry(deps, admin, { id: draft.id, data: { title: 'Entwurf 2' } }));
    const post = unwrap(await createEntry(deps, admin, { collection: 'posts', slug: 'p', data: { title: 'Sommerfest' } }));
    unwrap(await setEntryPublished(deps, admin, { id: post.id, isPublished: true }));
    expect(computePendingChanges(deps)?.items.map((i) => `${i.kind}:${i.label}`)).toEqual(['changed:Claim', 'added:Sommerfest']);
  });

  it('ignores publishes on test and failed publishes; a successful one in production clears the list', async () => {
    const deps = await setupPublicContent();
    stamp(deps);
    await dogOf(deps, 'Bruno');
    stamp(deps, { environment: 'test' });
    stamp(deps, { status: 'failed' });
    expect(computePendingChanges(deps)?.count).toBe(1);
    stamp(deps);
    expect(computePendingChanges(deps)?.count).toBe(0);
  });

  it('a used module switched off gives no answer instead of failing', async () => {
    const deps = await setupPublicContent();
    stamp(deps);
    await dogOf(deps, 'Bruno');
    unwrap(await setModuleEnabled(deps, admin, { key: 'animals', enabled: false }));
    expect(computePendingChanges(deps)).toMatchObject({ count: 0, items: [] });
  });

  it('reuses its result until the audit log grows', async () => {
    const deps = await setupPublicContent();
    stamp(deps);
    const view = deps.registry.module('animals')!.publishedViews![0]!;
    const load = vi.spyOn(view, 'load');
    computePendingChanges(deps);
    computePendingChanges(deps);
    expect(load).toHaveBeenCalledTimes(1);
    await dogOf(deps, 'Bruno');
    expect(computePendingChanges(deps)?.count).toBe(1);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('a view whose load throws switches the display off and logs once, instead of failing the poller', async () => {
    const deps = await setupPublicContent();
    stamp(deps);
    const view = deps.registry.module('animals')!.publishedViews![0]!;
    const load = vi.spyOn(view, 'load').mockImplementation(() => {
      throw new Error('kaputt');
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(computePendingChanges(deps)).toBeNull();
      expect(computePendingChanges(deps)).toBeNull();
      expect(log).toHaveBeenCalledTimes(1);
      expect(await sitePendingChanges(deps, admin, {})).toMatchObject({ ok: false, error: { type: 'conflict', code: 'pendingUnavailable' } });
    } finally {
      load.mockRestore();
      log.mockRestore();
    }
  });

  it('a deleted record that was online stays in the list by its name', async () => {
    const deps = await setupPublicContent();
    const bruno = await dogOf(deps, 'Bruno');
    stamp(deps);
    unwrap(await setAnimalPublished(deps, admin, { id: bruno.id, isPublished: false }));
    unwrap(await deleteAnimal(deps, admin, { id: bruno.id }));
    expect(computePendingChanges(deps)?.items).toEqual([expect.objectContaining({ kind: 'removed', label: 'Bruno' })]);
  });
});

describe('sitePendingChanges', () => {
  it('needs site.publish, validates the limit, cuts the list and says so', async () => {
    const deps = await setupPublicContent();
    stamp(deps);
    await dogOf(deps, 'Bruno');
    await dogOf(deps, 'Kira');
    expect(await sitePendingChanges(deps, ctxWith(['site.view']), {})).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await sitePendingChanges(deps, admin, { limit: 0 })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(unwrap(await sitePendingChanges(deps, admin, { limit: 1 }))).toMatchObject({ count: 2, truncated: true, items: [{ label: 'Bruno' }] });
    expect(unwrap(await sitePendingChanges(deps, admin))).toMatchObject({ count: 2, truncated: false });
  });
});
