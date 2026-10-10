import { coreModule, unwrap, writeSettingInternal, type CallContext } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser, systemContext, type TestDeps } from '@kompass/core/testing';
import sharp from 'sharp';
import { animalsModule, createAnimal, PROPOSALS_ENABLED_KEY, REVIEW_ON_MCP_WRITE_KEY } from '../src';

export const SOURCE_A = 'SOURCE-A';
export const SOURCE_B = 'SOURCE-B';

/** Kern und Tiere, Modul eingeschaltet (Haken wie `recordDeleted` laufen nur dann), Vorschläge an, Merker aus. */
export async function proposalDeps(opts: { proposals?: boolean; reviewOnMcpWrite?: boolean } = {}): Promise<TestDeps> {
  const deps = createTestDeps({ manifests: [coreModule, animalsModule], locales: ['de', 'en'] });
  insertUser(deps, { id: 'USER-TEST', name: 'Petra Prüferin' });
  insertUser(deps, { id: SOURCE_A, name: 'Tierbörse Nord' });
  insertUser(deps, { id: SOURCE_B, name: 'Tierbörse Süd' });
  deps.db.transaction((tx) => {
    unwrap(writeSettingInternal(tx, deps, systemContext(), 'modules.enabled', ['animals']));
    unwrap(writeSettingInternal(tx, deps, systemContext(), PROPOSALS_ENABLED_KEY, opts.proposals ?? true));
    unwrap(writeSettingInternal(tx, deps, systemContext(), REVIEW_ON_MCP_WRITE_KEY, opts.reviewOnMcpWrite ?? false));
  });
  return deps;
}

export const manager: CallContext = ctxWith(['animals.view', 'animals.manage', 'media.upload'], 'USER-TEST');
export const managerMcp: CallContext = { ...manager, channel: 'mcp' };
/** Ein Dienst-Token einer Quelle: sehen und vorschlagen, nichts ändern (Spec § 4). */
export const source = (userId: string = SOURCE_A): CallContext => ({ ...ctxWith(['animals.view', 'animals.propose'], userId), channel: 'mcp' });

/** Ein kleines PNG; `seed` macht die Bytes verschieden (Mediathek dedupliziert nach Inhalt). */
export async function png(seed: number): Promise<Uint8Array> {
  return new Uint8Array(await sharp({ create: { width: 4, height: 5, channels: 3, background: { r: seed % 256, g: 40, b: 90 } } }).png().toBuffer());
}

export const luna = { name: 'Luna', sex: 'female' as const, birthText: { de: '2022', en: '' }, sizeCm: 40, sizeText: { de: '40 cm', en: '' }, summary: { de: 'Ruhig.', en: '' }, body: { de: 'Text', en: '' } };
export async function animal(deps: TestDeps, overrides: Partial<typeof luna> = {}) {
  return unwrap(await createAnimal(deps, manager, { ...luna, ...overrides }));
}

/** Ein neuer Hund, wie ihn eine Quelle vorschlägt; Tasks 6–8 und der Ende-zu-Ende-Test teilen ihn. */
export const createInput = (over: Record<string, unknown> = {}) => ({
  kind: 'create' as const,
  sourceKey: 'hb-100-v1',
  externalRef: 'HB-100',
  externalUrl: 'https://quelle.example/hunde/100',
  values: { name: 'Lotte', sex: 'female' as const, birthText: { de: '2021' }, sizeText: { de: 'mittel' }, summary: { de: 'Fröhlich.' }, body: { de: 'Lang.' } } as Record<string, unknown>,
  hints: [{ field: 'birthText', quote: 'ca. Frühjahr 2021', suggestion: '2021' }, { title: 'Zaun im Titelbild' }],
  ...over,
});
