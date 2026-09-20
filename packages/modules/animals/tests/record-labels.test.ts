import { coreModule, setSetting, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { animalsModule } from '../src/manifest';
import { animalsRecordLabels } from '../src/record-labels';
import { createAnimal } from '../src/service';

describe('animalsRecordLabels', () => {
  const base = {
    slug: 'rocky',
    name: 'Rocky',
    sex: 'male' as const,
    birthText: { de: '' },
    sizeText: { de: '' },
    summary: { de: 'Kurz' },
    body: { de: 'Lang' },
  };

  const setup = async () => {
    const deps = createTestDeps({ manifests: [coreModule, animalsModule] });
    await setSetting(deps, ctxWith(['settings.manage']), { key: 'i18n.locales', value: ['de'] });
    const manage = ctxWith(['animals.view', 'animals.manage']);
    return { deps, manage };
  };

  it('answers only for animals', async () => {
    const { deps } = await setup();
    expect(animalsRecordLabels(deps, ctxWith(['animals.view']), 'contact', 'C1')).toBeNull();
  });

  it('labels an animal for a reader, and a neutral label for anyone else', async () => {
    const { deps, manage } = await setup();
    const animal = unwrap(await createAnimal(deps, manage, base));
    expect(animalsRecordLabels(deps, ctxWith(['animals.view']), 'animal', animal.id)).toEqual({
      label: 'Rocky',
      href: `/animals/${animal.id}`,
      state: 'ok',
    });
    expect(animalsRecordLabels(deps, ctxWith([]), 'animal', animal.id)).toEqual({
      label: 'Tier (kein Zugriff)',
      href: null,
      state: 'forbidden',
    });
  });

  it('says missing for an unknown id', async () => {
    const { deps } = await setup();
    expect(animalsRecordLabels(deps, ctxWith(['animals.view']), 'animal', 'NOPE')).toEqual({
      label: '',
      href: null,
      state: 'missing',
    });
  });
});
