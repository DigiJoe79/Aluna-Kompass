import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createDeps, readEnv } from '../src/app';
import { isSetupRequired } from '../src/setup/service';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('createDeps', () => {
  it('opens a file database, migrates it and can be reopened', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kompass-'));
    dirs.push(dir);
    const file = path.join(dir, 'kompass.db');
    const first = createDeps({ databasePath: file, mediaPath: path.join(dir, 'media'), env: 'test' });
    expect(first.migrationCount).toBeGreaterThanOrEqual(2);
    expect(first.media.rootDir).toBe(path.join(dir, 'media'));
    expect(isSetupRequired(first)).toBe(true);
    expect(first.registry.module('core')).toBeDefined();
    first.close();
    const second = createDeps({ databasePath: file, mediaPath: path.join(dir, 'media'), env: 'test' });
    expect(isSetupRequired(second)).toBe(true);
    second.close();
  });

  it('backups the database and reopens after the file was replaced', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kompass-'));
    dirs.push(dir);
    const file = path.join(dir, 'kompass.db');
    const deps = createDeps({ databasePath: file, mediaPath: path.join(dir, 'media'), env: 'test' });
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
  const base = { APP_ENV: 'production', DATABASE_PATH: '/data/kompass.db', MEDIA_PATH: '/media', PORT: '3000', SESSION_SECRET: 'x'.repeat(32) };

  it('parses a complete environment', () => {
    expect(readEnv(base)).toEqual({ env: 'production', databasePath: '/data/kompass.db', mediaPath: '/media', port: 3000, sessionSecret: 'x'.repeat(32) });
  });

  it('defaults to development with local paths when only the secret is set', () => {
    const env = readEnv({ SESSION_SECRET: 'y'.repeat(32) });
    expect(env.env).toBe('development');
    expect(env.databasePath).toBe('./data/kompass.db');
    expect(env.port).toBe(3000);
  });

  it('rejects unknown APP_ENV and short secrets', () => {
    expect(() => readEnv({ ...base, APP_ENV: 'staging' })).toThrow(/APP_ENV/);
    expect(() => readEnv({ ...base, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
  });
});
