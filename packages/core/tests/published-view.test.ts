import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { definePublishedView } from '../src/published/view';
import { createTestDeps } from '../src/testing';

describe('published views', () => {
  it('only exposes fields declared in the public schema', () => {
    const view = definePublishedView({
      name: 'projects',
      schema: z.object({ id: z.string(), name: z.string() }),
      load: () => [{ id: 'P1', name: 'Futterhilfe', internalNote: 'nicht öffentlich', reserveCents: 12345 }],
    });
    const deps = createTestDeps();
    expect(view.load(deps)).toEqual([{ id: 'P1', name: 'Futterhilfe' }]);
    expect(JSON.stringify(view.load(deps))).not.toContain('internalNote');
  });

  it('throws when a loader returns rows that violate the public schema', () => {
    const view = definePublishedView({ name: 'x', schema: z.object({ id: z.string() }), load: () => [{ id: 42 }] });
    expect(() => view.load(createTestDeps())).toThrow();
  });
});
