import { coreModule, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { animalsModule, createAnimal, requestAnimalReview, setAnimalPublished } from '../src';
import { ANIMALS_DASHBOARD_TILES } from '../src/dashboard';

/**
 * Die Kachel ist die Arbeitsliste: Sie zählt jedes Profil mit offener Prüfung,
 * ob veröffentlicht oder nicht. Die Warnung vor dem Publish zählt nur, was
 * live geht (`review.test.ts`).
 */
const manage = ctxWith(['animals.manage', 'animals.view']);
const dog = (name: string) => ({ name, sex: 'male' as const, birthText: {}, sizeText: {}, summary: {}, body: {} });
const setup = () => {
  const deps = createTestDeps({ manifests: [coreModule, animalsModule] });
  insertUser(deps, { id: 'USER-TEST' });
  return deps;
};
const tile = ANIMALS_DASHBOARD_TILES[0]!;

describe('animals tile reviewPending', () => {
  it('steht am Manifest mit Form, Recht und Vorgabe', () => {
    expect(animalsModule.dashboardTiles?.map((t) => `${t.key}:${t.kind}:${t.permission}:${t.defaultOn}`)).toEqual(['reviewPending:count:animals.view:true']);
  });

  it('zählt null, solange nichts wartet', async () => {
    const deps = setup();
    unwrap(await createAnimal(deps, manage, dog('ohne')));
    expect(await tile.load(deps, manage, tile.options.parse({}))).toEqual({ kind: 'count', count: 0, href: '/animals?review=1' });
  });

  it('zählt veröffentlichte wie unveröffentlichte Profile mit offener Prüfung', async () => {
    const deps = setup();
    const live = unwrap(await createAnimal(deps, manage, dog('live')));
    unwrap(await setAnimalPublished(deps, manage, { id: live.id, isPublished: true }));
    const draft = unwrap(await createAnimal(deps, manage, dog('entwurf')));
    unwrap(await createAnimal(deps, manage, dog('ohne')));
    unwrap(await requestAnimalReview(deps, manage, { id: live.id, note: 'Text geändert' }));
    unwrap(await requestAnimalReview(deps, manage, { id: draft.id, note: 'neu' }));
    expect(await tile.load(deps, manage, tile.options.parse({}))).toEqual({ kind: 'count', count: 2, href: '/animals?review=1' });
  });
});
