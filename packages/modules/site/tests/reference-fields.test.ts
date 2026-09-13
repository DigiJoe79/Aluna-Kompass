import { coreModule, setSetting, unwrap } from '@kompass/core';
import { animalsModule, createAnimal, setAnimalPublished, setAnimalStatus, setAnimalStory } from '@kompass/module-animals';
import { createProject, projectsModule, setProjectPublished } from '@kompass/module-projects';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { reference, references } from '@kompass/site-template';
import type { FieldSchema, TemplateSchema } from '../src/types';
import { checkReferenceFields, checkReferenceValues, duplicateReferences, findView, matchesWhere, referenceMetaOf, resolveReferenceOptions } from '../src/reference-fields';

const asJson = (s: unknown) => z.toJSONSchema(s as z.ZodType, { io: 'input' }) as FieldSchema;
const animalsCtx = ctxWith(['animals.manage', 'animals.view']);
const projectsCtx = ctxWith(['projects.manage', 'projects.view']);

const schemaWith = (variables: Record<string, FieldSchema>, uses: string[] = ['animals', 'projects']): TemplateSchema => ({ name: 'T', locales: ['de', 'en'], uses, variables, collections: {} });

const setup = async () => {
  const deps = createTestDeps({ manifests: [coreModule, animalsModule, projectsModule] });
  insertUser(deps, { id: 'USER-TEST' });
  await setSetting(deps, ctxWith(['settings.manage']), { key: 'i18n.locales', value: ['de', 'en'] });
  const dog = (slug: string, name: string) => createAnimal(deps, animalsCtx, { slug, name, sex: 'female', birthText: {}, sizeText: {}, summary: {}, body: {} });
  const bruno = unwrap(await dog('bruno', 'Bruno'));
  const akiko = unwrap(await dog('akiko', 'Akiko'));
  const draft = unwrap(await dog('entwurf', 'Entwurf'));
  for (const a of [bruno, akiko]) unwrap(await setAnimalPublished(deps, animalsCtx, { id: a.id, isPublished: true }));
  unwrap(await setAnimalStatus(deps, animalsCtx, { id: akiko.id, status: 'adopted', adoptedYear: 2025 }));
  unwrap(await setAnimalStory(deps, animalsCtx, { id: akiko.id, beforeAssetId: null, afterAssetId: null, quote: {}, family: '', adoptedYear: 2025 }));
  const hof = unwrap(await createProject(deps, projectsCtx, { slug: 'hof', name: { de: 'Der Hof', en: 'The yard' }, type: 'ongoing', summary: {}, body: {} }));
  // `name` ist bei Projekten in der Leitsprache Pflicht (Dienst) — die Sicht
  // darf trotzdem nicht strenger sein als das (§ 6); hier reicht ein zweites,
  // vollständig gepflegtes Projekt, um die Reihenfolge der Sicht zu zeigen.
  const futter = unwrap(await createProject(deps, projectsCtx, { slug: 'futter', name: { de: 'Futter', en: 'Food' }, type: 'ongoing', summary: {}, body: {} }));
  for (const p of [hof, futter]) unwrap(await setProjectPublished(deps, projectsCtx, { id: p.id, isPublished: true }));
  void draft;
  return deps;
};

describe('referenceMetaOf', () => {
  it('reads the widget metadata and defaults key and labelField', () => {
    expect(referenceMetaOf(asJson(reference({ view: 'animals' })))).toEqual({ view: 'animals', key: 'slug', labelField: 'name', where: undefined, multiple: false, max: undefined });
    expect(referenceMetaOf(asJson(references({ view: 'projects', max: 2, key: 'slug', labelField: 'name', where: { status: 'active' } })))).toEqual({ view: 'projects', key: 'slug', labelField: 'name', where: { status: 'active' }, multiple: true, max: 2 });
    expect(referenceMetaOf({ widget: 'text' })).toBe(null);
  });
});

describe('findView and matchesWhere', () => {
  it('finds a view of the core or of a module named in uses, and nothing else', async () => {
    const deps = await setup();
    expect(findView(deps, [], 'organization')?.moduleKey).toBe('core');
    expect(findView(deps, ['animals'], 'animals')?.moduleKey).toBe('animals');
    expect(findView(deps, [], 'animals')).toBe(null);
    expect(findView(deps, ['animals'], 'ghost')).toBe(null);
  });

  it('applies equality and presence, and nothing else', () => {
    expect(matchesWhere({ status: 'adopted', story: null }, { status: 'adopted' })).toBe(true);
    expect(matchesWhere({ status: 'adopted', story: null }, { status: 'adopted', story: { present: true } })).toBe(false);
    expect(matchesWhere({ status: 'adopted', story: { quote: {} } }, { status: 'adopted', story: { present: true } })).toBe(true);
    expect(matchesWhere({ isEmergency: true }, { isEmergency: true })).toBe(true);
    expect(matchesWhere({ isEmergency: false }, { isEmergency: true })).toBe(false);
    expect(matchesWhere({ anything: 1 }, undefined)).toBe(true);
  });
});

describe('resolveReferenceOptions', () => {
  it('lists published rows that satisfy where, labelled by name, in view order', async () => {
    const deps = await setup();
    const looking = resolveReferenceOptions(deps, ['animals'], asJson(reference({ view: 'animals', where: { status: 'lookingForHome' } })));
    expect(looking).toEqual([{ value: 'bruno', label: 'Bruno' }]);
    const stories = resolveReferenceOptions(deps, ['animals'], asJson(reference({ view: 'animals', where: { status: 'adopted', story: { present: true } } })));
    expect(stories).toEqual([{ value: 'akiko', label: 'Akiko' }]);
  });

  it('shows the localized label in the leading locale, in view order', async () => {
    const deps = await setup();
    const options = resolveReferenceOptions(deps, ['projects'], asJson(references({ view: 'projects', max: 2 })));
    expect(options).toEqual([{ value: 'hof', label: 'Der Hof' }, { value: 'futter', label: 'Futter' }]);
  });

  it('is empty for a view the template does not use', async () => {
    const deps = await setup();
    expect(resolveReferenceOptions(deps, [], asJson(reference({ view: 'animals' })))).toEqual([]);
  });
});

describe('checkReferenceValues and duplicateReferences', () => {
  it('names every value that is not among the options, per field', async () => {
    const deps = await setup();
    const schema = schemaWith({ dog: asJson(reference({ view: 'animals', where: { status: 'lookingForHome' } })), projects: asJson(references({ view: 'projects', max: 2 })) });
    expect(checkReferenceValues(deps, schema, { dog: 'bruno', projects: ['hof', 'futter'] })).toEqual([]);
    expect(checkReferenceValues(deps, schema, { dog: 'akiko', projects: ['hof', 'ghost'] })).toEqual([{ field: 'dog', value: 'akiko' }, { field: 'projects', value: 'ghost' }]);
    expect(checkReferenceValues(deps, schema, { dog: null, projects: [] })).toEqual([]);
    expect(checkReferenceValues(deps, schema, {})).toEqual([]);
  });

  it('finds a value used twice in a references field', () => {
    const schema = schemaWith({ projects: asJson(references({ view: 'projects', max: 2 })) });
    expect(duplicateReferences(schema, { projects: ['hof', 'hof'] })).toEqual(['projects']);
    expect(duplicateReferences(schema, { projects: ['hof', 'futter'] })).toEqual([]);
  });
});

describe('checkReferenceFields', () => {
  it('accepts a declaration whose view and fields exist', async () => {
    const deps = await setup();
    const schema = schemaWith({ dog: asJson(reference({ view: 'animals', where: { status: 'adopted', story: { present: true } } })) });
    expect(checkReferenceFields(deps, schema).ok).toBe(true);
  });

  it('refuses a view outside core and uses, and a field the view does not have', async () => {
    const deps = await setup();
    const noUse = checkReferenceFields(deps, schemaWith({ dog: asJson(reference({ view: 'animals' })) }, []));
    expect(noUse.ok === false && noUse.error.type === 'conflict' && noUse.error.code).toBe('unknownView');
    const badField = checkReferenceFields(deps, schemaWith({ dog: asJson(reference({ view: 'animals', where: { colour: 'red' } })) }));
    expect(badField.ok === false && badField.error.type === 'conflict' && badField.error.code).toBe('unknownViewField');
    const badLabel = checkReferenceFields(deps, schemaWith({ org: asJson(reference({ view: 'organization', key: 'name', labelField: 'nickname' })) }));
    expect(badLabel.ok === false && badLabel.error.type === 'conflict' && badLabel.error.code).toBe('unknownViewField');
  });
});
