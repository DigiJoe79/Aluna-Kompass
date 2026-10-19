import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { coreModule, createRegistry } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { installedModules } from '@/modules';

/**
 * Eine Einstellung mit `uiOnly` lässt sich nur in der Oberfläche ändern (Plan N1 Task 4, Befunde M1/M36). Fehlt ihr
 * dort die Stelle, kann der Verein sie nie setzen — so blieben der Agentenweg der Mitglieder und der Mailversand der
 * Akte über MCP für immer gesperrt. Dieser Wächter verlangt, dass jede solche Einstellung in mindestens einer Datei
 * unter `src/app` mit ihrem Schlüssel vorkommt, oder in der Ausnahmeliste steht — mit Begründung.
 */
const APP = path.resolve(import.meta.dirname, '../../src/app');

/** Schlüssel → Grund, warum die Einstellung keine eigene Stelle in der Oberfläche braucht. */
const EXCEPTIONS: Record<string, string> = {};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe('uiOnly-Einstellungen haben eine Oberfläche', () => {
  const sources = files(APP).map((f) => readFileSync(f, 'utf8'));
  const keys = [...createRegistry([coreModule, ...installedModules]).settingDefinitions.values()].filter((d) => d.uiOnly).map((d) => d.key);

  it('finds the uiOnly settings of the installation', () => {
    expect(keys).toEqual(expect.arrayContaining(['finance.mcpHumanOnlyAllowed', 'members.mcpHumanOnlyAllowed', 'dms.mcpHumanOnlyAllowed']));
  });

  it.each(keys)('%s is referenced under src/app or listed as exception with a reason', (key) => {
    const referenced = sources.some((s) => s.includes(`'${key}'`) || s.includes(`"${key}"`));
    expect(referenced || (EXCEPTIONS[key] ?? '').trim().length > 0).toBe(true);
  });

  it('lists no exception for a setting that is gone or not uiOnly', () => {
    for (const key of Object.keys(EXCEPTIONS)) expect(keys).toContain(key);
  });
});
