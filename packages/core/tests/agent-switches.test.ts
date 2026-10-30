import { z } from 'zod';
import { beforeEach, describe, expect, it } from 'vitest';
import { auditLog } from '../src/db/schema';
import { coreModule } from '../src/core-module';
import type { Deps } from '../src/deps';
import { defineModule } from '../src/modules/manifest';
import { listAgentSwitches, setAgentSwitches } from '../src/settings/agent-switches';
import { readSetting, writeSettingInternal } from '../src/settings/service';
import { createTestDeps, ctxWith, systemContext } from '../src/testing';

/**
 * Seite Verwaltung → Agenten (Spec 2026-10-29): Welche Schalter es gibt, leitet der Kern aus den Einstellungen ab —
 * `uiOnly` und Schlüssel `*.mcpHumanOnlyAllowed`, aus dem Kern und den eingeschalteten Modulen. Ein Modul darf seinen
 * Schalter führen (`managedBy`, wie die Finanzen); die Seite schreibt ihn trotzdem, ohne die Eigentümerschaft zu ändern.
 */
const alpha = defineModule({
  key: 'alpha',
  version: '0',
  permissions: [],
  settings: [
    { key: 'alpha.mcpHumanOnlyAllowed', schema: z.boolean(), default: false, uiOnly: true, managedBy: 'alpha' },
    { key: 'alpha.other', schema: z.boolean(), default: false, uiOnly: true },
  ],
});
const beta = defineModule({ key: 'beta', version: '0', permissions: [], settings: [{ key: 'beta.mcpHumanOnlyAllowed', schema: z.boolean(), default: false, uiOnly: true }] });
const gamma = defineModule({ key: 'gamma', version: '0', permissions: [], settings: [{ key: 'gamma.mcpHumanOnlyAllowed', schema: z.boolean(), default: false }] });

const admin = ctxWith(['settings.manage']);

function auditKeys(deps: Deps): string[] {
  return deps.db
    .select()
    .from(auditLog)
    .all()
    .filter((entry) => entry.action === 'settings.update')
    .map((entry) => entry.entityId ?? '');
}

describe('Agentenschalter', () => {
  let deps: Deps;
  beforeEach(() => {
    deps = createTestDeps({ manifests: [coreModule, alpha, beta, gamma] });
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'modules.enabled', ['alpha', 'gamma']));
  });

  it('listet genau die Schalter des Kerns und der eingeschalteten Module, mit Modul und Wert', async () => {
    const result = await listAgentSwitches(deps, admin);
    expect(result).toEqual({
      ok: true,
      value: [
        { key: 'backup.mcpHumanOnlyAllowed', module: 'core', value: false },
        { key: 'alpha.mcpHumanOnlyAllowed', module: 'alpha', value: false },
      ],
    });
  });

  it('ohne settings.manage weder Liste noch Speichern', async () => {
    const reader = ctxWith(['audit.view']);
    expect(await listAgentSwitches(deps, reader)).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await setAgentSwitches(deps, reader, { values: { 'alpha.mcpHumanOnlyAllowed': true } })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(readSetting(deps, 'alpha.mcpHumanOnlyAllowed')).toBe(false);
  });

  it('schreibt nur geänderte Schalter, je mit einem Protokolleintrag — auch einen, den das Modul führt', async () => {
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'backup.mcpHumanOnlyAllowed', true));
    const before = auditKeys(deps).length;
    const result = await setAgentSwitches(deps, admin, { values: { 'alpha.mcpHumanOnlyAllowed': true, 'backup.mcpHumanOnlyAllowed': true } });
    expect(result).toEqual({ ok: true, value: { changed: ['alpha.mcpHumanOnlyAllowed'] } });
    expect(readSetting(deps, 'alpha.mcpHumanOnlyAllowed')).toBe(true);
    expect(auditKeys(deps).slice(before)).toEqual(['alpha.mcpHumanOnlyAllowed']);
  });

  it('lehnt Schlüssel ab, die kein Schalter eines eingeschalteten Moduls sind, und schreibt dann nichts', async () => {
    for (const key of ['beta.mcpHumanOnlyAllowed', 'gamma.mcpHumanOnlyAllowed', 'alpha.other', 'gibt.es.nicht']) {
      const result = await setAgentSwitches(deps, admin, { values: { 'alpha.mcpHumanOnlyAllowed': true, [key]: true } });
      expect(result, key).toMatchObject({ ok: false, error: { type: 'validation' } });
    }
    expect(readSetting(deps, 'alpha.mcpHumanOnlyAllowed')).toBe(false);
  });

  it('lehnt einen Wert ab, der kein Ja/Nein ist', async () => {
    expect(await setAgentSwitches(deps, admin, { values: { 'alpha.mcpHumanOnlyAllowed': 'ja' } })).toMatchObject({ ok: false, error: { type: 'validation' } });
  });

  it('über MCP bleibt das Setzen abgelehnt (uiOnly)', async () => {
    const viaMcp = { ...admin, channel: 'mcp' as const };
    expect(await setAgentSwitches(deps, viaMcp, { values: { 'alpha.mcpHumanOnlyAllowed': true } })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'settingUiOnly' } });
    expect(readSetting(deps, 'alpha.mcpHumanOnlyAllowed')).toBe(false);
  });
});
