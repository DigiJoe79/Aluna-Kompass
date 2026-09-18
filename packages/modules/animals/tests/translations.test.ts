import { coreModule, schema, setSetting, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { animalsModule } from '../src/manifest';
import { createAnimal, getAnimal, setAnimalStatus, setAnimalStory } from '../src/service';
import { animalsSetTranslations, animalsTranslatables } from '../src/translations';

const manage = ctxWith(['animals.manage', 'animals.view']);
const view = ctxWith(['animals.view']);
const bruno = { slug: 'bruno', name: 'Bruno', sex: 'male' as const, birthText: { de: 'März 2020', en: '' }, sizeCm: 55, sizeText: { de: 'ca. 55 cm', en: 'approx. 55 cm' }, location: 'shelter' as const, isEmergency: false, isSponsorable: false, traits: { de: ['ruhig'], en: [] }, externalProfileUrl: '', summary: { de: 'Sanfter Rüde.', en: '' }, body: { de: '', en: '' } };

const setup = async () => {
  const deps = createTestDeps({ manifests: [coreModule, animalsModule] });
  insertUser(deps, { id: 'USER-TEST' });
  await setSetting(deps, ctxWith(['settings.manage']), { key: 'i18n.locales', value: ['de', 'en'] });
  const a = unwrap(await createAnimal(deps, manage, bruno));
  return { deps, id: a.id };
};

describe('animals translations', () => {
  it('lists every animal, drafts included, with its localized fields and the story fields once a story exists', async () => {
    const { deps, id } = await setup();
    const before = unwrap(animalsTranslatables(deps, view));
    expect(before).toEqual([{ entityType: 'animal', id, label: 'Bruno', href: `/animals/${id}`, fields: { birthText: bruno.birthText, sizeText: bruno.sizeText, traits: bruno.traits, summary: bruno.summary, body: bruno.body } }]);
    unwrap(await setAnimalStatus(deps, manage, { id, status: 'adopted', adoptedYear: 2025 }));
    unwrap(await setAnimalStory(deps, manage, { id, beforeAssetId: null, afterAssetId: null, quote: { de: 'Endlich daheim.', en: '' }, family: 'Familie M.', adoptedYear: 2025 }));
    const after = unwrap(animalsTranslatables(deps, view))[0]!;
    expect(Object.keys(after.fields)).toEqual(['birthText', 'sizeText', 'traits', 'summary', 'body', 'story.quote', 'story.beforeCaption', 'story.afterCaption']);
    expect(after.fields['story.quote']).toEqual({ de: 'Endlich daheim.', en: '' });
  });

  it('is forbidden without animals.view and ignores foreign entity types', async () => {
    const { deps, id } = await setup();
    const denied = animalsTranslatables(deps, ctxWith([]));
    expect(denied.ok === false && denied.error.type).toBe('forbidden');
    expect(animalsSetTranslations(deps, manage, { entityType: 'project', id, items: [] })).toBeNull();
  });

  it('writes only the named locales, in one update with one audit entry', async () => {
    const { deps, id } = await setup();
    const auditBefore = deps.db.select().from(schema.auditLog).all().length;
    const result = await animalsSetTranslations(deps, manage, {
      entityType: 'animal',
      id,
      items: [
        { field: 'summary', locale: 'en', text: 'Gentle boy.' },
        { field: 'traits', locale: 'en', text: ['calm'] },
        { field: 'birthText', locale: 'en', text: 'March 2020' },
      ],
    });
    expect(result && (await result).ok).toBe(true);
    const a = unwrap(await getAnimal(deps, view, id));
    expect(a.summary).toEqual({ de: 'Sanfter Rüde.', en: 'Gentle boy.' });
    expect(a.traits).toEqual({ de: ['ruhig'], en: ['calm'] });
    expect(a.birthText).toEqual({ de: 'März 2020', en: 'March 2020' });
    const audits = deps.db.select().from(schema.auditLog).all().slice(auditBefore);
    expect(audits.map((e) => e.action)).toEqual(['animals.update']);
  });

  it('writes story fields through setAnimalStory', async () => {
    const { deps, id } = await setup();
    unwrap(await setAnimalStatus(deps, manage, { id, status: 'adopted', adoptedYear: 2025 }));
    unwrap(await setAnimalStory(deps, manage, { id, beforeAssetId: null, afterAssetId: null, quote: { de: 'Endlich daheim.', en: '' }, family: 'Familie M.', adoptedYear: 2025 }));
    const result = await animalsSetTranslations(deps, manage, { entityType: 'animal', id, items: [{ field: 'story.quote', locale: 'en', text: 'Home at last.' }] });
    expect(result && (await result).ok).toBe(true);
    expect(unwrap(await getAnimal(deps, view, id)).story?.quote).toEqual({ de: 'Endlich daheim.', en: 'Home at last.' });
    expect(deps.db.select().from(schema.auditLog).all().at(-1)?.action).toBe('animals.setStory');
  });

  it('is forbidden without animals.manage, notFound for a foreign id, an unknown field, or a story field without a story', async () => {
    const { deps, id } = await setup();
    const denied = await animalsSetTranslations(deps, view, { entityType: 'animal', id, items: [{ field: 'summary', locale: 'en', text: 'x' }] });
    expect(denied && !denied.ok && denied.error.type).toBe('forbidden');
    const missing = await animalsSetTranslations(deps, manage, { entityType: 'animal', id: 'nope', items: [{ field: 'summary', locale: 'en', text: 'x' }] });
    expect(missing && !missing.ok && missing.error).toEqual({ type: 'notFound', entity: 'animal', id: 'nope' });
    const field = await animalsSetTranslations(deps, manage, { entityType: 'animal', id, items: [{ field: 'name', locale: 'en', text: 'x' }] });
    expect(field && !field.ok && field.error).toEqual({ type: 'notFound', entity: 'field', id: 'name' });
    const story = await animalsSetTranslations(deps, manage, { entityType: 'animal', id, items: [{ field: 'story.quote', locale: 'en', text: 'x' }] });
    expect(story && !story.ok && story.error).toEqual({ type: 'notFound', entity: 'field', id: 'story.quote' });
  });

  it('is wired into the manifest', () => {
    expect(animalsModule.translatables).toBe(animalsTranslatables);
    expect(animalsModule.setTranslations).toBe(animalsSetTranslations);
  });
});
