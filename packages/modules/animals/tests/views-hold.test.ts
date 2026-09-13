import { coreModule, setSetting, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser, loadAllViews } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { animalsModule, createAnimal, setAnimalPublished, setAnimalStatus, setAnimalStory } from '../src';

const manage = ctxWith(['animals.manage', 'animals.view']);

/**
 * Was der Dienst annimmt, muss die Sicht liefern (Spec § 6). Der Datensatz
 * hier trägt nur die Pflichtfelder; jede mehrsprachige Angabe bleibt leer.
 */
describe('animals views hold against what the service accepts', () => {
  it('a minimal published animal with a bare story loads through every view', async () => {
    const deps = createTestDeps({ manifests: [coreModule, animalsModule] });
    insertUser(deps, { id: 'USER-TEST' });
    await setSetting(deps, ctxWith(['settings.manage']), { key: 'i18n.locales', value: ['de', 'en'] });

    const a = unwrap(await createAnimal(deps, manage, { slug: 'minimal', name: 'Minimal', sex: 'male', birthText: {}, sizeText: {}, summary: {}, body: {} }));
    unwrap(await setAnimalPublished(deps, manage, { id: a.id, isPublished: true }));
    unwrap(await setAnimalStatus(deps, manage, { id: a.id, status: 'adopted', adoptedYear: 2026 }));
    unwrap(await setAnimalStory(deps, manage, { id: a.id, beforeAssetId: null, afterAssetId: null, quote: {}, family: '', adoptedYear: 2026 }));

    const views = loadAllViews(deps, animalsModule);
    expect(views.animals).toEqual([expect.objectContaining({ slug: 'minimal', traits: {}, story: expect.objectContaining({ adoptedYear: 2026 }) })]);
  });
});
