import { describe, expect, it } from 'vitest';
import {
  aiLabelingEnabled,
  AI_LABELING_DEFAULTS,
  AI_LABELING_ENABLED_KEY,
  AI_LABELING_SETTINGS,
  AI_LABELING_TEXT_KEYS,
  coreModule,
  readAiLabelingTexts,
  setSetting,
  unwrap,
} from '../src';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';

describe('AI labeling settings', () => {
  it('defaults to off', () => {
    const deps = createTestDeps({ manifests: [coreModule] });
    expect(aiLabelingEnabled(deps)).toBe(false);
  });

  it('every text key has a default in every shipped locale and a setting', () => {
    const deps = createTestDeps({ manifests: [coreModule] });
    const texts = readAiLabelingTexts(deps);
    const settingKeys = new Set(AI_LABELING_SETTINGS.map((s) => s.key));
    const names = Object.keys(AI_LABELING_DEFAULTS) as (keyof typeof AI_LABELING_DEFAULTS)[];
    expect(names).toContain('editedMark');
    expect(names).toHaveLength(AI_LABELING_TEXT_KEYS.length);
    for (const name of names) {
      const key = AI_LABELING_TEXT_KEYS[name];
      expect(AI_LABELING_TEXT_KEYS).toContain(key);
      expect(settingKeys.has(key)).toBe(true);
      for (const locale of ['de', 'en']) {
        expect(AI_LABELING_DEFAULTS[name][locale]?.trim().length ?? 0).toBeGreaterThan(0);
        expect(texts[name][locale]).toBe(AI_LABELING_DEFAULTS[name][locale]);
      }
    }
  });

  it('rejects an empty mark', async () => {
    const deps = createTestDeps({ manifests: [coreModule] });
    insertUser(deps, { id: 'USER-TEST' });
    const ctx = ctxWith(['settings.manage']);
    const result = await setSetting(deps, ctx, {
      key: 'media.aiLabeling.mark',
      value: { de: '' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('validation');
    }
  });

  it('rejects an empty edited mark like the mark', async () => {
    const deps = createTestDeps({ manifests: [coreModule] });
    insertUser(deps, { id: 'USER-TEST' });
    const ctx = ctxWith(['settings.manage']);
    const result = await setSetting(deps, ctx, { key: 'media.aiLabeling.editedMark', value: { de: '' } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('validation');
  });
});
