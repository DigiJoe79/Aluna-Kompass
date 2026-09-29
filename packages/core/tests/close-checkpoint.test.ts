import { existsSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDeps } from '../src';

let dataPath: string;
beforeEach(async () => {
  dataPath = await mkdtemp(path.join(tmpdir(), 'kompass-close-'));
});
afterEach(async () => {
  await rm(dataPath, { recursive: true, force: true });
});

describe('close() überträgt die WAL-Datei', () => {
  it('auch wenn noch eine zweite Verbindung offen ist', () => {
    const deps = createDeps({ dataPath, env: 'test', runInstalls: false });
    deps.sqlite.exec('CREATE TABLE close_marker (x)');
    // Wie ein Hintergrundprozess oder eine alte Verbindung: liest einmal, bleibt offen.
    const other = new Database(deps.databasePath);
    other.prepare('SELECT count(*) FROM close_marker').get();
    try {
      deps.close();
      const wal = `${deps.databasePath}-wal`;
      expect(!existsSync(wal) || statSync(wal).size === 0).toBe(true);
      const copy = new Database(deps.databasePath, { readonly: true });
      try {
        expect(copy.prepare("SELECT name FROM sqlite_master WHERE name = 'close_marker'").get()).toBeDefined();
      } finally {
        copy.close();
      }
    } finally {
      other.close();
    }
  });
});
