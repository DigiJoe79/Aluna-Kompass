import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createDeps, readEnv } from '../src/app';
import { defineModule } from '../src/modules/manifest';
import { isSetupRequired } from '../src/setup/service';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('createDeps', () => {
  it('opens a file database, migrates it and can be reopened', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kompass-'));
    dirs.push(dir);
    const file = path.join(dir, 'core', 'db', 'kompass.db');
    const first = createDeps({ dataPath: dir, env: 'test' });
    expect(first.migrationCount).toBeGreaterThanOrEqual(2);
    expect(first.media.rootDir).toBe(path.join(dir, 'core', 'media'));
    expect(isSetupRequired(first)).toBe(true);
    expect(first.registry.module('core')).toBeDefined();
    first.close();
    const second = createDeps({ dataPath: dir, env: 'test' });
    expect(isSetupRequired(second)).toBe(true);
    second.close();
  });

  it('backups the database and reopens after the file was replaced', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kompass-'));
    dirs.push(dir);
    const file = path.join(dir, 'core', 'db', 'kompass.db');
    const deps = createDeps({ dataPath: dir, env: 'test' });
    const dest = path.join(dir, 'copy.db');
    await deps.backupDatabase(dest);
    const copy = new Database(dest, { readonly: true });
    expect((copy.prepare('select count(*) as n from users').get() as { n: number }).n).toBe(0);
    copy.close();
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${file}${suffix}`, { force: true });
    expect(existsSync(file)).toBe(false);
    deps.reopen();
    expect(existsSync(file)).toBe(true);
    expect(isSetupRequired(deps)).toBe(true);
    expect(deps.migrationCount).toBeGreaterThanOrEqual(2);
    deps.close();
  });
});

describe('readEnv', () => {
  const base = { APP_ENV: 'production', DATA_PATH: '/data', PORT: '3000', SESSION_SECRET: 'x'.repeat(32) };

  it('parses a complete environment', () => {
    expect(readEnv(base)).toEqual({ env: 'production', dataPath: '/data', port: 3000, sessionSecret: 'x'.repeat(32), documentTemplatesDir: null });
  });

  it('defaults to development with local paths when only the secret is set', () => {
    const env = readEnv({ SESSION_SECRET: 'y'.repeat(32) });
    expect(env.env).toBe('development');
    expect(env.dataPath).toBe('./data');
    expect(env.port).toBe(3000);
  });

  it('rejects unknown APP_ENV and short secrets', () => {
    expect(() => readEnv({ ...base, APP_ENV: 'staging' })).toThrow(/APP_ENV/);
    expect(() => readEnv({ ...base, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
  });
});

describe('Verzeichnislayout unter dataPath', () => {
  it('legt Datenbank und Mediathek unter core ab', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kompass-'));
    dirs.push(dir);
    const deps = createDeps({ dataPath: dir, env: 'test' });
    expect(deps.databasePath).toBe(path.join(dir, 'core', 'db', 'kompass.db'));
    expect(deps.media.rootDir).toBe(path.join(dir, 'core', 'media'));
    expect(existsSync(deps.databasePath)).toBe(true);
    deps.close();
  });

  it('gibt jedem Modul mit Dateien ein eigenes Verzeichnis unter seinem Schlüssel', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kompass-'));
    dirs.push(dir);
    const storing = defineModule({ key: 'ablage', version: '0.0.1', permissions: [], files: true });
    const plain = defineModule({ key: 'schlicht', version: '0.0.1', permissions: [] });
    const deps = createDeps({ dataPath: dir, env: 'test', modules: [storing, plain] });
    expect(deps.files('ablage').rootDir).toBe(path.join(dir, 'ablage'));
    expect(() => deps.files('schlicht')).toThrow();
    deps.close();
  });

  it('leitet die Pfade aus DATA_PATH ab', () => {
    const env = readEnv({ DATA_PATH: '/irgendwo', SESSION_SECRET: 'x'.repeat(32), APP_ENV: 'test' });
    expect(env.dataPath).toBe('/irgendwo');
  });
});
