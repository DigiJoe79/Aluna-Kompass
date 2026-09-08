import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDeps, readSetting } from '@kompass/core';
import { afterEach, describe, expect, it } from 'vitest';
import { devReset } from '../../../../scripts/dev-reset';
import { cleanupPrototypes, fakePrototype } from './prototype-fixture';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  cleanupPrototypes();
});

function workspace() {
  const dir = mkdtempSync(path.join(tmpdir(), 'dev-reset-'));
  dirs.push(dir);
  const proto = fakePrototype();
  return {
    databasePath: path.join(dir, 'data', 'kompass.db'),
    mediaPath: path.join(dir, 'media'),
    prototypeDir: proto,
    templateDir: path.join(dir, 'data', 'site-template'),
  };
}

describe('devReset', () => {
  it('refuses to run outside the development environment', async () => {
    const ws = workspace();
    await expect(devReset({ ...ws, env: 'production' })).rejects.toThrow(/development/);
    await expect(devReset({ ...ws, env: 'test' })).rejects.toThrow(/development/);
    expect(existsSync(ws.databasePath)).toBe(false);
  });

  it('creates a fresh database with the seed admin and the imported content', async () => {
    const ws = workspace();
    const result = await devReset({ ...ws, env: 'development' });
    expect(existsSync(ws.databasePath)).toBe(true);
    expect(result.adminEmail).toContain('@');
    expect(result.adminPassword.length).toBeGreaterThan(8);
    expect(result.counts).toEqual({ animals: 2, projects: 1 });
    expect(result.organizationName).toBe('Beispielverein e.V.');
  });

  it('takes the organisation name from the prototype instead of the generic seed', async () => {
    const ws = workspace();
    await devReset({ ...ws, env: 'development' });
    const deps = createDeps({ databasePath: ws.databasePath, mediaPath: ws.mediaPath, env: 'development' });
    try {
      expect(readSetting<string>(deps, 'organization.name')).toBe('Beispielverein e.V.');
    } finally {
      deps.close();
    }
  });

  /**
   * Im Container legt der Entrypoint das Basis-Template ins Volume. In der
   * Entwicklung tat das niemand — dort blieb liegen, was zuletzt hineinkopiert
   * wurde, und das Einlesen las das Template eines fremden Vereins.
   */
  it('sets up the base template beside the fresh database', async () => {
    const ws = workspace();
    await devReset({ ...ws, env: 'development' });
    expect(existsSync(path.join(ws.templateDir, 'kompass.template.ts'))).toBe(true);
    expect(existsSync(path.join(ws.templateDir, 'node_modules', 'astro'))).toBe(true);
  });

  it('leaves a template that is already there alone', async () => {
    const ws = workspace();
    mkdirSync(ws.templateDir, { recursive: true });
    writeFileSync(path.join(ws.templateDir, 'kompass.template.ts'), '// selbst gebaut\n');
    await devReset({ ...ws, env: 'development' });
    expect(readFileSync(path.join(ws.templateDir, 'kompass.template.ts'), 'utf8')).toBe('// selbst gebaut\n');
  });

  it('discards an existing database and its media instead of importing on top', async () => {
    const ws = workspace();
    await devReset({ ...ws, env: 'development' });
    writeFileSync(path.join(ws.mediaPath, 'verwaist.bin'), 'alt');
    // Zweiter Lauf: alles neu, deshalb dieselben Zahlen wie beim ersten Mal.
    const again = await devReset({ ...ws, env: 'development' });
    expect(again.counts.animals).toBe(2);
    expect(existsSync(path.join(ws.mediaPath, 'verwaist.bin'))).toBe(false);
  });
});
