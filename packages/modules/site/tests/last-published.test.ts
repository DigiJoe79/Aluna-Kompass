import { coreModule } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { siteModule } from '../src/manifest';
import { recordPublish } from '../src/services/publishes';

describe('lastPublishedAt', () => {
  it('liefert ohne Publish null, danach die Zeit des letzten erfolgreichen', () => {
    const deps = createTestDeps({ manifests: [coreModule, siteModule] });
    insertUser(deps, { id: 'U1' });
    const ctx = ctxWith(['site.publish'], 'U1');
    expect(siteModule.lastPublishedAt!(deps)).toBeNull();
    const base = { contentHash: 'h', diff: { changed: [], added: [], removed: [] }, fileManifest: {}, log: '', summary: '' };
    recordPublish(deps, ctx, { ...base, environment: deps.env, startedAt: '2026-10-01T08:00:00.000Z', status: 'success' });
    const first = siteModule.lastPublishedAt!(deps);
    expect(first).toEqual(expect.any(String));
    recordPublish(deps, ctx, { ...base, environment: deps.env, startedAt: '2026-10-02T08:00:00.000Z', status: 'failed' });
    expect(siteModule.lastPublishedAt!(deps)).toBe(first);
  });
});
