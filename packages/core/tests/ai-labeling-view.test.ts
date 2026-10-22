import { describe, expect, it } from 'vitest';
import {
  AI_LABELING_DEFAULTS,
  AI_LABELING_ENABLED_KEY,
  coreModule,
  publishedAiLabeling,
  setSetting,
  unwrap,
} from '../src';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';

const setupWithUser = () => {
  const deps = createTestDeps({ manifests: [coreModule], locales: ['de', 'en'] });
  insertUser(deps, { id: 'USER-TEST' });
  const ctx = ctxWith(['settings.manage']);
  return { deps, ctx };
};

describe('published aiLabeling view', () => {
  it('is part of the core views', () => {
    expect(coreModule.publishedViews?.some((v) => v.name === 'aiLabeling')).toBe(true);
  });

  it('has no row while switched off', () => {
    const deps = createTestDeps({ manifests: [coreModule] });
    const rows = publishedAiLabeling.load(deps);
    expect(rows).toEqual([]);
  });

  it('has one row with every text while switched on', async () => {
    const { deps, ctx } = setupWithUser();
    unwrap(await setSetting(deps, ctx, { key: AI_LABELING_ENABLED_KEY, value: true }));

    const rows = publishedAiLabeling.load(deps) as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    const [row] = rows;
    for (const key of Object.keys(AI_LABELING_DEFAULTS)) {
      expect(row).toHaveProperty(key);
    }
  });

  it('keeps a text changed in the settings', async () => {
    const { deps, ctx } = setupWithUser();
    unwrap(await setSetting(deps, ctx, { key: AI_LABELING_ENABLED_KEY, value: true }));
    unwrap(
      await setSetting(deps, ctx, {
        key: 'media.aiLabeling.mark',
        value: { de: 'AI-Marke', en: 'AI mark' },
      }),
    );

    const rows = publishedAiLabeling.load(deps) as { mark: Record<string, string> }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.mark).toEqual({ de: 'AI-Marke', en: 'AI mark' });
  });

  it('carries editedMark when labeling is on, nothing when off', async () => {
    const { deps, ctx } = setupWithUser();
    expect(publishedAiLabeling.load(deps)).toEqual([]);
    unwrap(await setSetting(deps, ctx, { key: AI_LABELING_ENABLED_KEY, value: true }));
    unwrap(await setSetting(deps, ctx, { key: 'media.aiLabeling.editedMark', value: { de: 'Retusche', en: 'Retouched' } }));
    const rows = publishedAiLabeling.load(deps) as { editedMark: Record<string, string> }[];
    expect(rows[0]!.editedMark).toEqual({ de: 'Retusche', en: 'Retouched' });
    expect(publishedAiLabeling.schema.safeParse(rows[0]).success).toBe(true);
  });
});
