import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { coreModule, createRegistry } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { installedModules } from '@/modules';

/**
 * Plan U4 Task 1 (Nachtrag MCP-Test § 1, Designer 2026-10-19): Die Erlaubnis für Agenten ist der Baustein
 * `AgentSwitchSection` — letzter Abschnitt des Formulars, gespeichert mit ihm. Kein Panel baut den Schalter für eine
 * Einstellung `…mcpHumanOnlyAllowed` selbst nach; jede solche Einstellung steht als `name` an einem `AgentSwitchSection`.
 */
const APP = path.resolve(import.meta.dirname, '../../src/app');
const SECTION = path.join(APP, '(shell)/admin/agent-switch-section.tsx');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return name.endsWith('.tsx') ? [full] : [];
  });
}

describe('Agentenschalter nur über AgentSwitchSection', () => {
  const sources = files(APP).map((file) => ({ file, text: readFileSync(file, 'utf8') }));
  const keys = [...createRegistry([coreModule, ...installedModules]).settingDefinitions.values()].filter((d) => d.uiOnly && d.key.endsWith('.mcpHumanOnlyAllowed')).map((d) => d.key);

  it('finds the agent switches of the installation', () => {
    expect(keys).toEqual(expect.arrayContaining(['finance.mcpHumanOnlyAllowed', 'members.mcpHumanOnlyAllowed', 'dms.mcpHumanOnlyAllowed']));
  });

  it('no panel renders its own Switch for an agent setting', () => {
    const offenders = sources.filter(({ file, text }) => file !== SECTION && /<Switch\b/.test(text) && /mcpHumanOnly/i.test(text)).map(({ file }) => path.relative(APP, file));
    expect(offenders).toEqual([]);
  });

  it.each(keys)('%s is the name of an AgentSwitchSection', (key) => {
    const host = sources.filter(({ text }) => /<AgentSwitchSection\b/.test(text) && (text.includes(`'${key}'`) || text.includes(`"${key}"`)));
    expect(host.length).toBeGreaterThan(0);
  });
});
