import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { coreModule, defineModule, definePublishedView } from '../src';
import { createTestDeps, loadAllViews } from '../src/testing';

describe('loadAllViews', () => {
  it('loads every view of a manifest and returns the rows by view name', () => {
    const deps = createTestDeps({ manifests: [coreModule] });
    const views = loadAllViews(deps, coreModule);
    expect(Object.keys(views)).toEqual(['organization']);
    expect(views.organization).toHaveLength(1);
  });

  it('names the view and the field when a loader violates its own schema', () => {
    const broken = defineModule({
      key: 'broken',
      version: '0.0.1',
      permissions: [],
      publishedViews: [definePublishedView({ name: 'things', schema: z.object({ name: z.string() }), load: () => [{ name: 42 }] })],
    });
    const deps = createTestDeps({ manifests: [coreModule, broken] });
    expect(() => loadAllViews(deps, broken)).toThrow(/view "things" rejects its own rows: name/);
  });

  it('the organization view holds against an installation that has set nothing', () => {
    const deps = createTestDeps({ manifests: [coreModule] });
    expect(() => loadAllViews(deps, coreModule)).not.toThrow();
  });
});
