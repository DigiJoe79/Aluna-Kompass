import { z } from 'zod';
import type { CallContext } from '../context';
import type { Deps } from '../deps';
import { requirePermission } from '../permissions/check';
import { conflict, invalid, ok, type Result } from '../result';
import { validate } from '../validate';
import { readSetting, writeSettingInternal } from './service';

/** Die Endung, an der Kern und Module ihre Erlaubnis für Agenten führen (E10, Plan U4). */
const AGENT_SWITCH_SUFFIX = '.mcpHumanOnlyAllowed';

export interface AgentSwitch {
  /** Schlüssel der Einstellung, etwa `governance.mcpHumanOnlyAllowed`. */
  key: string;
  /** Das Modul, das die Einstellung mitbringt (`core` für den Kern). */
  module: string;
  value: boolean;
}

/**
 * Die Agentenschalter dieser Installation (Spec Seite „Agenten“, 2026-10-29): jede `uiOnly`-Einstellung mit der Endung
 * `.mcpHumanOnlyAllowed` aus dem Kern und den eingeschalteten Modulen, in der Reihenfolge der Registry. Kein Katalog —
 * ein neues Modul mit Schalter erscheint von selbst.
 */
function availableSwitches(deps: Deps): { key: string; module: string }[] {
  const enabled = readSetting<string[]>(deps, 'modules.enabled');
  return deps.registry.manifests
    .filter((manifest) => manifest.key === 'core' || enabled.includes(manifest.key))
    .flatMap((manifest) => (manifest.settings ?? []).filter((def) => def.uiOnly && def.key.endsWith(AGENT_SWITCH_SUFFIX)).map((def) => ({ key: def.key, module: manifest.key })));
}

export async function listAgentSwitches(deps: Deps, ctx: CallContext): Promise<Result<AgentSwitch[]>> {
  const denied = requirePermission(ctx, 'settings.manage');
  if (denied) return denied;
  return ok(availableSwitches(deps).map((s) => ({ ...s, value: readSetting<boolean>(deps, s.key) === true })));
}

const setAgentSwitchesSchema = z.object({ values: z.record(z.string(), z.boolean()) });

/**
 * Speichert die Seite „Agenten“: nur die Schalter, deren Wert sich ändert, in einer Transaktion, je mit einem Eintrag
 * `settings.update`. Wie `setSetting` mit `settings.manage` und nie über MCP (`uiOnly`); anders als `setSetting` auch
 * einen Schalter, den sein Modul führt (`managedBy`, etwa `finance.mcpHumanOnlyAllowed`) — über `writeSettingInternal`,
 * den Weg, den auch der Dienst der Finanzen nimmt. Die Eigentümerschaft bleibt beim Modul; die Prüfungen hier ersetzen
 * seine: nur dieser eine Schalter, nur ja oder nein.
 */
export async function setAgentSwitches(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ changed: string[] }>> {
  const denied = requirePermission(ctx, 'settings.manage');
  if (denied) return denied;
  const parsed = validate(deps, setAgentSwitchesSchema, input);
  if (!parsed.ok) return parsed;
  const known = new Set(availableSwitches(deps).map((s) => s.key));
  const unknown = Object.keys(parsed.value.values).filter((key) => !known.has(key));
  if (unknown.length > 0) return invalid(unknown.map((key) => ({ path: `values.${key}`, message: 'unknownSetting' })));
  const keys = Object.keys(parsed.value.values);
  if (ctx.channel === 'mcp' && keys.length > 0) return conflict('settingUiOnly', keys[0]!);
  const changed = keys.filter((key) => readSetting<boolean>(deps, key) !== parsed.value.values[key]);
  return deps.db.transaction((tx) => {
    for (const key of changed) {
      const written = writeSettingInternal(tx, deps, ctx, key, parsed.value.values[key]);
      if (!written.ok) return written;
    }
    return ok({ changed });
  });
}
