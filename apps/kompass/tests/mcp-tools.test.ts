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
 * Rechte, die bewusst ohne MCP-Werkzeug bleiben. Backup hängt an Dateiströmen —
 * ein Backup von einigen hundert Megabyte durch JSON-RPC zu reichen, brächte
 * niemandem etwas; es läuft über Route Handler. Die sechs `dms.*`-Rechte sind
 * mit dem Modul selbst nur umgezogen (Plan „dms-1-umzug"); ihre Werkzeuge
 * bringt Plan „dms-4-oberflaeche-mcp-seed" (§ 7 der Spec). Wer hier einträgt,
 * entscheidet bewusst; wer ein Recht ergänzt, ohne es hier oder in einem
 * Werkzeug zu nennen, bekommt einen roten Test.
 */
const WITHOUT_MCP = new Set(['backup.export', 'backup.import', 'dms.manage']);

/** Rechte, die kein Werkzeug nennt, als `modul: recht`. */
const uncoveredPermissions = (pairs: [ModuleManifest, readonly McpToolDefinition[]][]) =>
  pairs.flatMap(([manifest, tools]) =>
    manifest.permissions
      .filter((key) => !WITHOUT_MCP.has(key) && !tools.some((tool) => tool.description.includes(key)))
      .map((key) => `${manifest.key}: ${key}`),
  );

const jsonSchema = (tool: McpToolDefinition) => {
  const schema = z.toJSONSchema(tool.inputSchema, { io: 'input' }) as {
    properties?: Record<string, unknown>;
    additionalProperties?: unknown;
    oneOf?: Array<{ properties?: Record<string, unknown>; additionalProperties?: unknown }>;
  };
  if (schema.oneOf) {
    const combined = Object.assign({}, ...schema.oneOf.map((s) => s.properties ?? {}));
    return { ...schema, properties: combined };
  }
  return schema;
};

describe('registered mcp tools', () => {
  it('names the arguments of every tool that takes some', () => {
    const takesArguments = registeredTools.filter((tool) => tool.handler.length > 2);
    expect(takesArguments.length).toBeGreaterThan(20);
    const silent = takesArguments.filter((tool) => Object.keys(jsonSchema(tool).properties ?? {}).length === 0).map((tool) => tool.name);
    expect(silent).toEqual([]);
  });

  it('accepts nothing beyond the named arguments', () => {
    const open = registeredTools
      .filter((tool) => {
        const schema = jsonSchema(tool) as { additionalProperties?: unknown; oneOf?: Array<{ additionalProperties?: unknown }> };
        if (schema.oneOf) {
          return schema.oneOf.some((branch) => (branch.additionalProperties ?? false) !== false);
        }
        return (schema.additionalProperties ?? false) !== false;
      })
      .map((tool) => tool.name);
    expect(open).toEqual([]);
  });

  it('offers a tool for every permission a module defines', () => {
    expect(uncoveredPermissions(modulesWithTools)).toEqual([]);
  });

  /**
   * `contacts_delete` fehlt bewusst. Das unwiederbringliche Löschen
   * personenbezogener Daten soll einen Menschen vor einem Bildschirm haben, der
   * zeigt, was gleich verschwindet. Ein Agent, der eine Fälligkeitsliste falsch
   * liest, löscht sonst dreißig Spender. Die Fälligkeitsliste selbst ist über
   * `contacts_due` lesbar — nur das Ausführen bleibt der Oberfläche vorbehalten.
   */
  it('offers no tool that deletes a contact', () => {
    expect(registeredTools.map((tool) => tool.name)).not.toContain('contacts_delete');
    expect(registeredTools.some((tool) => tool.name === 'contacts_due')).toBe(true);
  });

  /**
   * `dms_delete_document` fehlt bewusst. Eine Löschung nach Fristablauf
   * bestätigt ein Mensch am Fristenbildschirm (Entscheidung 10).
   */
  it('offers no tool that deletes a document', () => {
    expect(registeredTools.map((tool) => tool.name)).not.toContain('dms_delete_document');
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
