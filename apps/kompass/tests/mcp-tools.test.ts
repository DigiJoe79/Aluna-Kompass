import type { McpToolDefinition } from '@kompass/core';
import { coreMcpTools } from '@kompass/mcp';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { installedModules } from '@/modules';

const registeredTools: McpToolDefinition[] = [...coreMcpTools, ...installedModules.flatMap((m) => m.mcpTools ?? [])];

const jsonSchema = (tool: McpToolDefinition) => z.toJSONSchema(tool.inputSchema, { io: 'input' }) as { properties?: Record<string, unknown>; additionalProperties?: unknown };

describe('registered mcp tools', () => {
  it('names the arguments of every tool that takes some', () => {
    const takesArguments = registeredTools.filter((tool) => tool.handler.length > 2);
    expect(takesArguments.length).toBeGreaterThan(20);
    const silent = takesArguments.filter((tool) => Object.keys(jsonSchema(tool).properties ?? {}).length === 0).map((tool) => tool.name);
    expect(silent).toEqual([]);
  });

  it('accepts nothing beyond the named arguments', () => {
    const open = registeredTools.filter((tool) => (jsonSchema(tool).additionalProperties ?? false) !== false).map((tool) => tool.name);
    expect(open).toEqual([]);
  });
});
