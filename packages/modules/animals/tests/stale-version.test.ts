import { coreModule, setSetting, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { animalsModule, createAnimal, getAnimal, setAnimalStatus, setAnimalStory, updateAnimal } from '../src';

/**
 * Backlog 20: Eine Maske, die vor einer MCP-Änderung geöffnet wurde, darf diese
 * beim Speichern nicht still zurückdrehen. Sie nennt ihren Ladestand
 * (`expectedVersion` = `updatedAt` beim Laden); ist er veraltet, gibt es
 * `conflict('staleVersion')`, und nichts wird geschrieben.
 */
const setup = async () => {
  const d = createTestDeps({ manifests: [coreModule, animalsModule] });
  insertUser(d, { id: 'USER-TEST' });
  await setSetting(d, ctxWith(['settings.manage']), { key: 'i18n.locales', value: ['de', 'en'] });
  return d;
};
const manage = ctxWith(['animals.manage', 'animals.view']);
const akiko = { slug: 'akiko', name: 'Akiko', sex: 'female' as const, birthText: { de: '2022', en: '' }, sizeCm: 40, sizeText: { de: '40 cm', en: '' }, location: 'shelter' as const, isEmergency: false, isSponsorable: false, traits: { de: [], en: [] }, externalProfileUrl: '', summary: { de: 'Kurz', en: '' }, body: { de: 'Lang', en: '' } };

describe('updateAnimal mit Ladestand', () => {
  it('weist ein Speichern auf veraltetem Stand ab und lässt die Zwischenänderung stehen', async () => {
    const d = await setup();
    const loaded = unwrap(await createAnimal(d, manage, akiko));
    d.clock.advance(60_000);
    unwrap(await updateAnimal(d, manage, { id: loaded.id, summary: { de: 'Kurz', en: 'Short' } }));
    d.clock.advance(60_000);

    const stale = await updateAnimal(d, manage, { id: loaded.id, summary: { de: 'Kürzer', en: '' }, expectedVersion: loaded.updatedAt });

    expect(stale).toMatchObject({ ok: false, error: { type: 'conflict', code: 'staleVersion' } });
    expect(unwrap(await getAnimal(d, manage, loaded.id)).summary).toEqual({ de: 'Kurz', en: 'Short' });
  });

  it('speichert, wer den aktuellen Stand nennt', async () => {
    const d = await setup();
    const loaded = unwrap(await createAnimal(d, manage, akiko));
    d.clock.advance(60_000);
    const saved = unwrap(await updateAnimal(d, manage, { id: loaded.id, name: 'Aki', expectedVersion: loaded.updatedAt }));
    expect(saved.name).toBe('Aki');
  });

  it('prüft auch die Erfolgsgeschichte gegen den Stand des Tiers', async () => {
    const d = await setup();
    const created = unwrap(await createAnimal(d, manage, akiko));
    const loaded = unwrap(await setAnimalStatus(d, manage, { id: created.id, status: 'adopted', adoptedYear: 2026 }));
    d.clock.advance(60_000);
    const story = { id: loaded.id, beforeAssetId: null, afterAssetId: null, quote: { de: 'Zitat', en: '' }, family: 'Familie K.', adoptedYear: 2026 };
    unwrap(await setAnimalStory(d, manage, { ...story, quote: { de: 'Zitat', en: 'Quote' } }));
    d.clock.advance(60_000);

    const stale = await setAnimalStory(d, manage, { ...story, expectedVersion: loaded.updatedAt });

    expect(stale).toMatchObject({ ok: false, error: { type: 'conflict', code: 'staleVersion' } });
    expect(unwrap(await getAnimal(d, manage, loaded.id)).story?.quote).toEqual({ de: 'Zitat', en: 'Quote' });
  });

  it('lässt Bildunterschriften stehen, die ein Aufruf nicht nennt', async () => {
    const d = await setup();
    const created = unwrap(await createAnimal(d, manage, akiko));
    unwrap(await setAnimalStatus(d, manage, { id: created.id, status: 'adopted', adoptedYear: 2026 }));
    const story = { id: created.id, beforeAssetId: null, afterAssetId: null, quote: { de: 'Zitat', en: '' }, family: 'Familie K.', adoptedYear: 2026 };
    unwrap(await setAnimalStory(d, manage, { ...story, beforeCaption: { de: 'Im Tierheim', en: '' }, afterCaption: { de: 'Zuhause', en: '' } }));

    const after = unwrap(await setAnimalStory(d, manage, { ...story, quote: { de: 'Neues Zitat', en: '' } }));

    expect(after.story).toMatchObject({ quote: { de: 'Neues Zitat', en: '' }, beforeCaption: { de: 'Im Tierheim', en: '' }, afterCaption: { de: 'Zuhause', en: '' } });
  });
});
