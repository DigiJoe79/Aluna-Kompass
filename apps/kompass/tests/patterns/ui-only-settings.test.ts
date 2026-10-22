import path from 'node:path';
import { coreModule, createRegistry } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { installedModules } from '@/modules';
import { type Allowlist, allowlistHygiene, read, relative, sourceFiles, SRC } from './source';

/**
 * Eine Einstellung mit `uiOnly` lässt sich nur in der Oberfläche ändern (Plan N1 Task 4, Befunde M1/M36). Fehlt ihr
 * dort die Stelle, kann der Verein sie nie setzen — so blieben der Agentenweg der Mitglieder und der Mailversand der
 * Akte über MCP für immer gesperrt. Jede solche Einstellung kommt deshalb in mindestens einer Datei unter `src/app` mit
 * ihrem Schlüssel vor, oder steht in der Ausnahmeliste — mit Begründung.
 *
 * Die Erlaubnis für Agenten (`…mcpHumanOnlyAllowed`, Plan U4 Task 1, Designer 2026-10-19) ist der Baustein
 * `AgentSwitchSection` — letzter Abschnitt des Formulars, gespeichert mit ihm. Kein Panel baut den Schalter selbst nach;
 * jede solche Einstellung steht als `name` an einem `AgentSwitchSection`.
 */
const APP = path.join(SRC, 'app');
const SECTION = 'app/(shell)/admin/agent-switch-section.tsx';

/** Schlüssel → Grund, warum die Einstellung keine eigene Stelle in der Oberfläche braucht. */
export const EXCEPTIONS: Allowlist = {};

const sources = sourceFiles(APP).map((file) => ({ file: relative(file), text: read(file) }));
const mentions = (text: string, key: string) => text.includes(`'${key}'`) || text.includes(`"${key}"`);
const uiOnly = [...createRegistry([coreModule, ...installedModules]).settingDefinitions.values()].filter((d) => d.uiOnly).map((d) => d.key);
const agentSwitches = uiOnly.filter((key) => key.endsWith('.mcpHumanOnlyAllowed'));

describe('uiOnly-Einstellungen haben eine Oberfläche', () => {
  it('die Registry liefert uiOnly-Einstellungen und Agentenschalter (sonst prüfte der Wächter nichts)', () => {
    expect(uiOnly.length).toBeGreaterThan(0);
    expect(agentSwitches.length).toBeGreaterThan(0);
  });

  it.each(uiOnly)('%s is referenced under src/app or listed as exception with a reason', (key) => {
    const referenced = sources.some(({ text }) => mentions(text, key));
    expect(referenced || (EXCEPTIONS[key] ?? '').trim().length > 0).toBe(true);
  });

  // Nötig ist eine Ausnahme, solange die Einstellung `uiOnly` ist und keine Stelle hat.
  allowlistHygiene(EXCEPTIONS, () => Object.keys(EXCEPTIONS).filter((key) => !uiOnly.includes(key) || sources.some(({ text }) => mentions(text, key))));
});

describe('Agentenschalter nur über AgentSwitchSection', () => {
  it('no panel renders its own Switch for an agent setting', () => {
    const offenders = sources.filter(({ file, text }) => file !== SECTION && /<Switch\b/.test(text) && /mcpHumanOnly/i.test(text)).map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it.each(agentSwitches)('%s is the name of an AgentSwitchSection', (key) => {
    expect(sources.some(({ text }) => /<AgentSwitchSection\b/.test(text) && mentions(text, key))).toBe(true);
  });
});
