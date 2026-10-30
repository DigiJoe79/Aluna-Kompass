import path from 'node:path';
import { coreModule, createRegistry } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { installedModules } from '@/modules';
import messages from '../../messages/de.json';
import { type Allowlist, allowlistHygiene, read, relative, sourceFiles, SRC } from './source';

/**
 * Eine Einstellung mit `uiOnly` lässt sich nur in der Oberfläche ändern (Plan N1 Task 4, Befunde M1/M36). Fehlt ihr
 * dort die Stelle, kann der Verein sie nie setzen — so blieben der Agentenweg der Mitglieder und der Mailversand der
 * Akte über MCP für immer gesperrt. Jede solche Einstellung kommt deshalb in mindestens einer Datei unter `src/app` mit
 * ihrem Schlüssel vor, oder steht in der Ausnahmeliste — mit Begründung.
 *
 * Die Erlaubnis für Agenten (`…mcpHumanOnlyAllowed`) hat seit der Spec Seite „Agenten“ (2026-10-29) genau eine Stelle:
 * Verwaltung → Agenten. Die Seite leitet die Schalter aus der Registry ab (`listAgentSwitches`), nennt also keinen
 * Schlüssel; dafür braucht jeder Schalter dort Titel, Frage und Hinweis in `admin.agents.switches.<Bereich>`. Der
 * Baustein `AgentSwitchSection` steht nur auf dieser Seite, kein Modulformular hat einen Abschnitt „Agent“, und kein
 * Panel baut den Schalter selbst nach.
 */
const APP = path.join(SRC, 'app');
const SECTION = 'app/(shell)/admin/agent-switch-section.tsx';
const AGENTS_PAGE = 'app/(shell)/admin/agents/';

/** Schlüssel → Grund, warum die Einstellung keine eigene Stelle in der Oberfläche braucht. */
export const EXCEPTIONS: Allowlist = {};

const sources = sourceFiles(APP).map((file) => ({ file: relative(file), text: read(file) }));
const mentions = (text: string, key: string) => text.includes(`'${key}'`) || text.includes(`"${key}"`);
const uiOnly = [...createRegistry([coreModule, ...installedModules]).settingDefinitions.values()].filter((d) => d.uiOnly).map((d) => d.key);
const isAgentSwitch = (key: string) => key.endsWith('.mcpHumanOnlyAllowed');
const agentSwitches = uiOnly.filter(isAgentSwitch);
const otherUiOnly = uiOnly.filter((key) => !isAgentSwitch(key));
const agentTexts = (messages as { admin: { agents: { switches: Record<string, Record<string, string>> } } }).admin.agents.switches;

describe('uiOnly-Einstellungen haben eine Oberfläche', () => {
  it('die Registry liefert uiOnly-Einstellungen und Agentenschalter (sonst prüfte der Wächter nichts)', () => {
    expect(uiOnly.length).toBeGreaterThan(0);
    expect(agentSwitches.length).toBeGreaterThan(0);
  });

  it.each(otherUiOnly)('%s is referenced under src/app or listed as exception with a reason', (key) => {
    const referenced = sources.some(({ text }) => mentions(text, key));
    expect(referenced || (EXCEPTIONS[key] ?? '').trim().length > 0).toBe(true);
  });

  // Nötig ist eine Ausnahme, solange die Einstellung `uiOnly` ist und keine Stelle hat.
  allowlistHygiene(EXCEPTIONS, () => Object.keys(EXCEPTIONS).filter((key) => !uiOnly.includes(key) || sources.some(({ text }) => mentions(text, key))));
});

describe('Agentenschalter nur auf der Seite Agenten', () => {
  it.each(agentSwitches)('%s has title, question and hint on the agents page', (key) => {
    const texts = agentTexts[key.split('.')[0]!];
    for (const field of ['title', 'label', 'hint']) expect(texts?.[field]?.trim(), `${key}: ${field}`).toBeTruthy();
  });

  it('no text for a switch that no setting has', () => {
    const areas = new Set(agentSwitches.map((key) => key.split('.')[0]!));
    expect(Object.keys(agentTexts).filter((area) => !areas.has(area))).toEqual([]);
  });

  it('AgentSwitchSection is used only on the agents page — no module form has a section „Agent“', () => {
    const offenders = sources.filter(({ file, text }) => file !== SECTION && !file.startsWith(AGENTS_PAGE) && /\bAgentSwitchSection\b/.test(text)).map(({ file }) => file);
    expect(offenders).toEqual([]);
    expect(sources.some(({ file, text }) => file.startsWith(AGENTS_PAGE) && /<AgentSwitchSection\b/.test(text))).toBe(true);
  });

  it('no panel renders its own Switch for an agent setting', () => {
    const offenders = sources.filter(({ file, text }) => file !== SECTION && /<Switch\b/.test(text) && /mcpHumanOnly/i.test(text)).map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
