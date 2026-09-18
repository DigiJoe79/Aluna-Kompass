import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { coreModule, createRegistry } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { installedModules } from '@/modules';
import { groupPermissions } from '@/lib/permission-groups';

/**
 * Zwei Prüfungen, die eine Rechteumbenennung sonst nur die E2E-Suite merken
 * lässt — und dort erst nach zwei Minuten und mit einem Absturz der
 * Rollenseite (`MISSING_MESSAGE`). Beide fielen beim Umzug der Akte ins Modul
 * `dms` auf: `documents.create` blieb in der Oberfläche stehen, und die neuen
 * `dms.*`-Rechte hatten keine Beschriftung.
 */
const messages = JSON.parse(readFileSync(new URL('../messages/de.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const registry = createRegistry([coreModule, ...installedModules]);

function messageAt(dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages);
}

describe('permission labels', () => {
  it('beschriftet jedes Recht der Registry in de.json', () => {
    const missing = [...registry.permissionKeys].flatMap((key) =>
      ['label', 'description'].filter((field) => typeof messageAt(`permissions.keys.${key}.${field}`) !== 'string').map((field) => `${key}.${field}`),
    );
    expect(missing).toEqual([]);
  });

  it('beschriftet jede Rechtegruppe in de.json', () => {
    const missing = groupPermissions([coreModule, ...installedModules])
      .map((group) => group.labelKey)
      .filter((labelKey) => typeof messageAt(labelKey) !== 'string');
    expect(missing).toEqual([]);
  });

  it('führt keine Beschriftung für ein Recht, das es nicht mehr gibt', () => {
    const keys = (messageAt('permissions.keys') ?? {}) as Record<string, Record<string, unknown>>;
    const labelled = Object.entries(keys).flatMap(([area, verbs]) => Object.keys(verbs).map((verb) => `${area}.${verb}`));
    expect(labelled.filter((key) => !registry.permissionKeys.has(key))).toEqual([]);
  });
});

const SOURCE_DIR = fileURLToPath(new URL('../src', import.meta.url));
const PERMISSION_USE = /(?:hasPermission|requirePermission)\(\s*ctx\s*,\s*'([a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*)'|permission[=:]\s*['"]([a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*)['"]/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

describe('permission usage', () => {
  it('nennt in der Oberfläche nur Rechte, die es gibt', () => {
    const unknown: string[] = [];
    for (const file of sourceFiles(SOURCE_DIR)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(PERMISSION_USE)) {
        const key = match[1] ?? match[2];
        if (key && !registry.permissionKeys.has(key)) unknown.push(`${path.relative(SOURCE_DIR, file)}: ${key}`);
      }
    }
    expect(unknown).toEqual([]);
  });
});
