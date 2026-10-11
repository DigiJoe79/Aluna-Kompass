import { describe, expect, it } from 'vitest';
import { coreModule, defineModule, imagePlaces, moduleImagePlaces, unknownImagePlaceKeys, writeSettingInternal, type ImageRatio } from '../src';
import { createTestDeps, ctxWith } from '../src/testing';

// Spec Ausschnitt für alle Bilder § 2: Module melden ihre Bildstellen an, das Template gibt Format und Breite.
const zoo = (fallback?: ImageRatio) =>
  defineModule({
    key: 'zoo',
    version: '1',
    permissions: [],
    imagePlaces: [
      { key: 'zoo.primary', label: 'media.crop.places.zooPrimary', ...(fallback ? { fallback: () => fallback } : {}) },
      { key: 'zoo.gallery', label: 'media.crop.places.zooGallery', lightbox: 'media.crop.places.lightbox' },
      { key: 'zoo.cover', label: 'media.crop.places.zooCover', labels: ['media.crop.places.zooTile', 'media.crop.places.zooHero'] },
    ],
  });
const web = (images: Record<string, unknown> | undefined) => defineModule({ key: 'web', version: '1', permissions: [], imagePlaceSpecs: () => images });

const setup = (images: Record<string, unknown> | undefined, fallback?: ImageRatio, enabled = ['zoo', 'web']) => {
  const deps = createTestDeps({ manifests: [coreModule, zoo(fallback), web(images)] });
  deps.db.transaction((tx) => writeSettingInternal(tx, deps, ctxWith(['settings.manage']), 'modules.enabled', enabled));
  return deps;
};

describe('imagePlaces', () => {
  it('liest die Angabe des Templates und benennt die Stellen je Format', () => {
    const deps = setup({ 'zoo.cover': { ratio: ['16:10', '16:9'], width: 1200 } });
    expect(imagePlaces(deps, 'zoo.cover')).toEqual({
      formats: ['16:10', '16:9'],
      places: [
        { ratio: '16:10', minWidthPx: 1600, labelKey: 'media.crop.places.zooTile' },
        { ratio: '16:9', minWidthPx: 1600, labelKey: 'media.crop.places.zooHero' },
      ],
      source: 'template',
    });
  });

  it('fällt ohne Angabe auf den Rückfall des Moduls, sonst auf die volle Reihe zurück; das Template gewinnt', () => {
    expect(imagePlaces(setup({}, '4:3'), 'zoo.primary')).toEqual({ formats: ['4:3'], places: [{ ratio: '4:3', minWidthPx: 960, labelKey: 'media.crop.places.zooPrimary' }], source: 'fallback' });
    expect(imagePlaces(setup({ 'zoo.primary': { ratio: '4:5', width: 600 } }, '4:3'), 'zoo.primary')).toMatchObject({ formats: ['4:5'], source: 'template' });
    expect(imagePlaces(setup(undefined), 'zoo.primary')).toMatchObject({ formats: [], source: 'none' });
  });

  it('hängt der Galerie die Lightbox an', () => {
    expect(imagePlaces(setup({ 'zoo.gallery': { ratio: '4:3', width: 400 } }), 'zoo.gallery').places).toEqual([
      { ratio: '4:3', minWidthPx: 480, labelKey: 'media.crop.places.zooGallery' },
      { ratio: 'original', minWidthPx: 0, labelKey: 'media.crop.places.lightbox', lightbox: true },
    ]);
  });

  it('kennt nur Stellen eingeschalteter Module und meldet die übrigen als unbekannt', () => {
    const deps = setup({ 'zoo.primary': { ratio: '1:1' }, 'shop.banner': { ratio: '3:1' } });
    expect(unknownImagePlaceKeys(deps, { 'zoo.primary': {}, 'shop.banner': {} })).toEqual(['shop.banner']);
    const off = setup({ 'zoo.primary': { ratio: '1:1' } }, undefined, ['web']);
    expect(unknownImagePlaceKeys(off, { 'zoo.primary': {} })).toEqual(['zoo.primary']);
    expect(imagePlaces(off, 'zoo.primary')).toMatchObject({ formats: ['1:1'], places: [{ ratio: '1:1', minWidthPx: 960 }] });
  });

  it('liefert alle Stellen eines Moduls', () => {
    expect(Object.keys(moduleImagePlaces(setup({}), 'zoo'))).toEqual(['zoo.primary', 'zoo.gallery', 'zoo.cover']);
  });
});

describe('defineModule imagePlaces', () => {
  it('verlangt den Modulschlüssel vorn, keine Doppel und einen Namen', () => {
    expect(() => defineModule({ key: 'zoo', version: '1', permissions: [], imagePlaces: [{ key: 'other.primary', label: 'x' }] })).toThrow(/image place/);
    expect(() => defineModule({ key: 'zoo', version: '1', permissions: [], imagePlaces: [{ key: 'zoo', label: 'x' }] })).toThrow(/image place/);
    expect(() => defineModule({ key: 'zoo', version: '1', permissions: [], imagePlaces: [{ key: 'zoo.a', label: 'x' }, { key: 'zoo.a', label: 'y' }] })).toThrow(/duplicate/);
    expect(() => defineModule({ key: 'zoo', version: '1', permissions: [], imagePlaces: [{ key: 'zoo.a', label: ' ' }] })).toThrow(/label/);
  });
});
