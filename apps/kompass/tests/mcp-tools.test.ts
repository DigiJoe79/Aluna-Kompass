import { coreModule, moduleMcpTools, type McpToolDefinition, type ModuleManifest } from '@kompass/core';
import { createTestDeps } from '@kompass/core/testing';
import { coreMcpTools } from '@kompass/mcp';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { installedModules } from '@/modules';

// Die Werkzeugliste mancher Module (etwa `site`) entsteht erst zur Laufzeit aus
// `deps` — deshalb über `moduleMcpTools` statt direkt über das Manifest.
const deps = createTestDeps({ manifests: [coreModule, ...installedModules] });
const registeredTools: McpToolDefinition[] = [...coreMcpTools, ...installedModules.flatMap((m) => [...moduleMcpTools(deps, m)])];

// Die Kernwerkzeuge liegen in @kompass/mcp, nicht im Manifest des Kerns.
const modulesWithTools: [ModuleManifest, readonly McpToolDefinition[]][] = [
  [coreModule, coreMcpTools],
  ...installedModules.map((m): [ModuleManifest, readonly McpToolDefinition[]] => [m, moduleMcpTools(deps, m)]),
];

/**
 * Rechte, die bewusst ohne MCP-Werkzeug bleiben. Alle drei hängen an
 * Dateiströmen — ein Backup von einigen hundert Megabyte oder ein Foto durch
 * JSON-RPC zu reichen, brächte niemandem etwas; sie laufen über Route Handler.
 * Wer hier einträgt, entscheidet bewusst; wer ein Recht ergänzt, ohne es hier
 * oder in einem Werkzeug zu nennen, bekommt einen roten Test.
 */
const WITHOUT_MCP = new Set(['media.upload', 'backup.export', 'backup.import']);

/** Rechte, die kein Werkzeug nennt, als `modul: recht`. */
const uncoveredPermissions = (pairs: [ModuleManifest, readonly McpToolDefinition[]][]) =>
  pairs.flatMap(([manifest, tools]) =>
    manifest.permissions
      .filter((key) => !WITHOUT_MCP.has(key) && !tools.some((tool) => tool.description.includes(key)))
      .map((key) => `${manifest.key}: ${key}`),
  );

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

  it('offers a tool for every permission a module defines', () => {
    expect(uncoveredPermissions(modulesWithTools)).toEqual([]);
  });

  // Beweist, dass die Prüfung oben greift: ein erfundenes Modul, das seine
  // Rechte nicht über MCP anbietet, muss auffallen — sonst ist der grüne Test
  // darüber wertlos.
  it('names a module that brings a permission without a tool', () => {
    const newcomer: ModuleManifest = { key: 'members', version: '1', permissions: ['members.manage'] };
    expect(uncoveredPermissions([[newcomer, []]])).toEqual(['members: members.manage']);
    const withTool = [{ description: 'Create a member. Requires members.manage.' }] as unknown as McpToolDefinition[];
    expect(uncoveredPermissions([[newcomer, withTool]])).toEqual([]);
  });
});
