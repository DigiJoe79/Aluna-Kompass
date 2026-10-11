import { coreModule, imagePlaces, writeSettingInternal } from '@kompass/core';
import { createTestDeps, ctxWith } from '@kompass/core/testing';
import { animalsModule } from '@kompass/module-animals';
import { projectsModule } from '@kompass/module-projects';
import { describe, expect, it } from 'vitest';
import { fieldImagePlaces } from '../src/image-places';
import { siteModule } from '../src/manifest';
import { siteTemplateState } from '../src/schema';
import type { TemplateSchema } from '../src/types';

describe('fieldImagePlaces', () => {
  it('reads ratio and width from the field schema, with the label the caller gives', () => {
    expect(fieldImagePlaces({ widget: 'asset', accept: 'image/*', label: 'Foto', ratio: '1:1', width: 320 }, 'Team')).toEqual({
      formats: ['1:1'],
      places: [{ ratio: '1:1', minWidthPx: 480, label: 'Team' }],
      source: 'template',
    });
    expect(fieldImagePlaces({ widget: 'asset', label: 'Foto', ratio: '1:1' }).places[0]!.label).toBe('Foto');
  });

  it('behaves as today for a field without ratio or width', () => {
    expect(fieldImagePlaces({ widget: 'asset', accept: 'image/*' })).toEqual({ formats: [], places: [{ ratio: 'original', minWidthPx: 960 }], source: 'none' });
  });
});

// Das Site-Modul liefert dem Kern die Angaben des Templates; die Stellen melden Tiere und Projekte an.
describe('image places from the active template', () => {
  const setup = (images?: TemplateSchema['images']) => {
    const deps = createTestDeps({ manifests: [coreModule, animalsModule, projectsModule, siteModule] });
    const schema: TemplateSchema = { name: 'T', locales: ['de'], uses: [], variables: {}, collections: {}, ...(images ? { images } : {}) };
    deps.db.insert(siteTemplateState).values({ id: 'current', name: 'T', schemaJson: schema, checksum: 'x', readAt: '2026-10-10T00:00:00.000Z', readByUserId: null }).run();
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, ctxWith(['settings.manage']), 'modules.enabled', ['animals', 'projects', 'site']));
    return deps;
  };

  it('resolves the project image with tile and cover', () => {
    expect(imagePlaces(setup({ 'projects.image': { ratio: ['16:10', '16:9'], width: 1200 } }), 'projects.image')).toEqual({
      formats: ['16:10', '16:9'],
      places: [
        { ratio: '16:10', minWidthPx: 1600, labelKey: 'media.crop.places.projectTile' },
        { ratio: '16:9', minWidthPx: 1600, labelKey: 'media.crop.places.projectCover' },
      ],
      source: 'template',
    });
  });

  it('falls back for the primary photo to the setting „Bildausschnitt“, the template wins', () => {
    expect(imagePlaces(setup({}), 'animals.primary')).toMatchObject({ formats: ['4:3'], source: 'fallback' });
    expect(imagePlaces(setup({ 'animals.primary': { ratio: '4:5', width: 600 } }), 'animals.primary')).toMatchObject({ formats: ['4:5'], source: 'template' });
  });

  it('adds the lightbox to the gallery and works with a template read before 0.2.11', () => {
    expect(imagePlaces(setup(undefined), 'animals.gallery').places.map((p) => p.lightbox ?? false)).toEqual([false, true]);
    expect(imagePlaces(setup(undefined), 'animals.story')).toMatchObject({ formats: [], source: 'none' });
  });
});
