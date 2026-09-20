import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { coreModule } from '../src/core-module';
import { settings } from '../src/db/schema';
import { defineModule } from '../src/modules/manifest';
import { requireHumanChannel } from '../src/permissions/human';
import { createTestDeps, ctxWith, systemContext, TEST_NOW } from '../src/testing';

const demo = defineModule({ key: 'demo', version: '0', permissions: [], settings: [{ key: 'demo.mcpHumanOnlyAllowed', schema: z.boolean(), default: false }] });
const mcp = { ...ctxWith([]), channel: 'mcp' as const };

describe('requireHumanChannel', () => {
  it('lets ui and system through and stops mcp', () => {
    const deps = createTestDeps({ manifests: [coreModule, demo] });
    expect(requireHumanChannel(deps, ctxWith([]), 'demo.mcpHumanOnlyAllowed')).toBeNull();
    expect(requireHumanChannel(deps, systemContext(), 'demo.mcpHumanOnlyAllowed')).toBeNull();
    expect(requireHumanChannel(deps, mcp, 'demo.mcpHumanOnlyAllowed')?.error).toEqual({ type: 'conflict', code: 'humanOnly', message: 'demo.mcpHumanOnlyAllowed' });
  });

  it('lets mcp through once the association allows it', () => {
    const deps = createTestDeps({ manifests: [coreModule, demo] });
    deps.db.insert(settings).values({ key: 'demo.mcpHumanOnlyAllowed', value: 'true', updatedAt: TEST_NOW }).run();
    expect(requireHumanChannel(deps, mcp, 'demo.mcpHumanOnlyAllowed')).toBeNull();
  });
});
