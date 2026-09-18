import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineModule, moduleMcpTools, ok } from '../src';
import { createTestDeps } from '../src/testing';

const tool = (name: string) => ({
  name,
  description: `Does ${name}. Requires demo.manage.`,
  inputSchema: z.object({}),
  handler: async () => ok(null),
});

describe('runtime contributions', () => {
  it('takes a static tool list as before', () => {
    const m = defineModule({ key: 'demo', version: '1', permissions: ['demo.manage'], mcpTools: [tool('demo_a')] });
    expect(moduleMcpTools(createTestDeps(), m).map((t) => t.name)).toEqual(['demo_a']);
  });

  it('takes a function and calls it with deps', () => {
    const m = defineModule({ key: 'demo', version: '1', permissions: ['demo.manage'], mcpTools: (deps) => [tool(`demo_${deps.env}`)] });
    expect(moduleMcpTools(createTestDeps(), m).map((t) => t.name)).toEqual(['demo_test']);
  });

  it('treats a missing list as empty', () => {
    const m = defineModule({ key: 'demo', version: '1', permissions: [] });
    expect(moduleMcpTools(createTestDeps(), m)).toEqual([]);
  });
});
