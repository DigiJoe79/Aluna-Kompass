import { coreModule, unwrap, writeSettingInternal } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser, systemContext, type TestDeps } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { animalsModule, createAnimal, PROPOSALS_ENABLED_KEY, requestAnimalReview, REVIEW_ON_MCP_WRITE_KEY, setAnimalPublished, submitProposal } from '../src';
import { ANIMALS_DASHBOARD_TILES } from '../src/dashboard';
import { animal, createInput, manager, proposalDeps, source } from './proposal-fixture';

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
    expect(animalsModule.dashboardTiles?.map((t) => `${t.key}:${t.kind}:${t.permission}:${t.defaultOn}`)).toEqual(['reviewPending:count:animals.view:true', 'proposalsOpen:count:animals.manage:true']);
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

const byKey = (key: string) => ANIMALS_DASHBOARD_TILES.find((t) => t.key === key)!;
const set = (deps: TestDeps, key: string, value: unknown) =>
  deps.db.transaction((tx) => unwrap(writeSettingInternal(tx, deps, systemContext(), key, value)));

describe('animals tiles that follow their settings (Spec Vorschläge § 4, Board 1b)', () => {
  it('proposalsOpen counts open proposals, names the oldest in days and the conflicts', async () => {
    const deps = await proposalDeps();
    unwrap(await submitProposal(deps, source(), createInput()));
    const content = await byKey('proposalsOpen').load(deps, manager, {});
    expect(content).toMatchObject({ kind: 'count', count: 1, href: '/animals/proposals', note: { messageKey: 'oldest', values: { days: 0, conflicts: 0 } } });
  });

  it('proposalsOpen has no note while nothing is open', async () => {
    const deps = await proposalDeps();
    expect(await byKey('proposalsOpen').load(deps, manager, {})).toEqual({ kind: 'count', count: 0, href: '/animals/proposals' });
  });

  it('proposalsOpen is there while switched on or while proposals are still open', async () => {
    const deps = await proposalDeps({ proposals: false });
    expect(byKey('proposalsOpen').available!(deps)).toBe(false);
    set(deps, PROPOSALS_ENABLED_KEY, true);
    expect(byKey('proposalsOpen').available!(deps)).toBe(true);
    unwrap(await submitProposal(deps, source(), createInput()));
    set(deps, PROPOSALS_ENABLED_KEY, false);
    expect(byKey('proposalsOpen').available!(deps)).toBe(true);
  });

  it('reviewPending is there while the setting is on or an animal is still marked', async () => {
    const deps = await proposalDeps({ reviewOnMcpWrite: false });
    expect(byKey('reviewPending').available!(deps)).toBe(false);
    set(deps, REVIEW_ON_MCP_WRITE_KEY, true);
    expect(byKey('reviewPending').available!(deps)).toBe(true);
    set(deps, REVIEW_ON_MCP_WRITE_KEY, false);
    const a = await animal(deps);
    unwrap(await requestAnimalReview(deps, manager, { id: a.id, note: 'Bitte prüfen' }));
    expect(byKey('reviewPending').available!(deps)).toBe(true);
  });
});
