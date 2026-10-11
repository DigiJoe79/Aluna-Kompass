import { coreModule, defineModule, writeSettingInternal } from '@kompass/core';
import { createTestDeps, ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { animalsModule } from '../src/manifest';
import { effectivePhotoFrame, PHOTO_FRAME_KEY } from '../src/settings';

// Spec Ausschnitt für alle Bilder § 2: Gibt das Template das Hauptfoto vor, gewinnt es überall; sonst die Einstellung.
const site = (images?: Record<string, unknown>) => defineModule({ key: 'web', version: '1', permissions: [], imagePlaceSpecs: () => images });

const setup = (images?: Record<string, unknown>) => {
  const deps = createTestDeps({ manifests: [coreModule, animalsModule, site(images)] });
  const ctx = ctxWith(['settings.manage']);
  deps.db.transaction((tx) => {
    writeSettingInternal(tx, deps, ctx, 'modules.enabled', ['animals', 'web']);
    writeSettingInternal(tx, deps, ctx, PHOTO_FRAME_KEY, { aspect: '3:2', focusX: 40, focusY: 30 });
  });
  return deps;
};

describe('effectivePhotoFrame', () => {
  it('nimmt die Einstellung, wenn das Template nichts vorgibt', () => {
    expect(effectivePhotoFrame(setup())).toEqual({ aspect: '3:2', focusX: 40, focusY: 30 });
    expect(effectivePhotoFrame(setup({ 'animals.primary': { ratio: 'original' } }))).toEqual({ aspect: '3:2', focusX: 40, focusY: 30 });
  });

  it('nimmt das Format des Templates, den Blickpunkt aus der Einstellung', () => {
    expect(effectivePhotoFrame(setup({ 'animals.primary': { ratio: '4:5', width: 600 } }))).toEqual({ aspect: '4:5', focusX: 40, focusY: 30 });
    expect(effectivePhotoFrame(setup({ 'animals.primary': { ratio: ['1:1', '4:5'] } })).aspect).toBe('1:1');
  });
});
