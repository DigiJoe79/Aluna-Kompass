import { coreModule, enabledManifests, moduleMcpTools, writeSettingInternal } from '@kompass/core';
import { createTestDeps, systemContext } from '@kompass/core/testing';
import { coreMcpTools } from '@kompass/mcp';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { installedModules } from '@/modules';

/**
 * N5 (Nachrunde 28.09.): Eine bedingte Pflicht („`validFrom`, wenn `allowed`“) im Werkzeugschema prüft das MCP-SDK
 * selbst — und antwortet englisch, bevor der Dienst mit seinem Code aus der Sprachdatei zu Wort kommt. Deshalb trägt
 * kein Werkzeugschema eine eigene Prüfung (`refine`/`superRefine`) und keine Union an der Wurzel; beides prüft der
 * Dienst. Feldregeln wie `min(1)` oder `date()` bleiben erlaubt: Sie hängen an einem Feld, nicht an einem anderen.
 */
type Def = { type: string; checks?: { _zod: { def: { check: string } } }[]; shape?: Record<string, z.ZodType>; innerType?: z.ZodType; element?: z.ZodType; options?: z.ZodType[]; in?: z.ZodType; out?: z.ZodType };
const defOf = (s: z.ZodType) => (s as unknown as { _zod: { def: Def } })._zod.def;

function conditionalChecks(schema: z.ZodType, path: string, out: string[]): void {
  const def = defOf(schema);
  if ((def.checks ?? []).some((c) => c._zod.def.check === 'custom')) out.push(`${path || '(root)'}: refine`);
  if (def.type === 'union' && path === '') out.push('(root): union');
  if (def.type === 'object') for (const [k, v] of Object.entries(def.shape ?? {})) conditionalChecks(v, path ? `${path}.${k}` : k, out);
  for (const inner of [def.innerType, def.element, def.in, def.out]) if (inner) conditionalChecks(inner, path, out);
  for (const option of def.options ?? []) conditionalChecks(option, path, out);
}

describe('MCP-Werkzeugschemas ohne bedingte Pflicht (N5)', () => {
  it('kein Werkzeugschema prüft ein Feld abhängig von einem anderen — das tut der Dienst', () => {
    const deps = createTestDeps({ manifests: [coreModule, ...installedModules] });
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'modules.enabled', installedModules.map((m) => m.key)));
    const tools = [...coreMcpTools, ...enabledManifests(deps).flatMap((m) => [...moduleMcpTools(deps, m)])];
    expect(tools.length).toBeGreaterThan(200);
    const offenders = tools.flatMap((t) => {
      const found: string[] = [];
      conditionalChecks(t.inputSchema as z.ZodType, '', found);
      return found.map((f) => `${t.name} ${f}`);
    });
    expect(offenders).toEqual([]);
  });
});
