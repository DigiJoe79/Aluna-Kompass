import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '@kompass/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Beim Beenden schliesst Kompass die Datenbank.
 *
 * Next beantwortet ein `SIGTERM` (etwa `docker stop`) selbst mit
 * `process.exit(143)`. Ohne eigenes Zutun blieb die Verbindung dabei offen, und
 * SQLite übertrug die WAL-Datei nie in die Hauptdatei: Am 19.09. stand in Prod
 * der gesamte Bestand seit der Einrichtung in `kompass.db-wal`, die
 * `kompass.db` war 4 KB gross. Wer nur die Hauptdatei kopiert, hätte nichts
 * gehabt.
 *
 * Erst `close()` der letzten Verbindung überträgt und löscht die WAL-Datei. Im
 * `exit`-Ereignis geht das noch, weil `better-sqlite3` synchron arbeitet.
 */

const MARKER = 'shutdown_marker';

let dataPath: string;
let previous: Record<string, string | undefined>;

function clearHolder(): void {
  const holder = (globalThis as { __kompass?: { deps: { close(): void } | null } }).__kompass;
  try {
    holder?.deps?.close();
  } catch {
    // schon zu
  }
  if (holder) holder.deps = null;
}

beforeEach(async () => {
  dataPath = await mkdtemp(path.join(tmpdir(), 'kompass-shutdown-'));
  previous = {
    APP_ENV: process.env.APP_ENV,
    DATA_PATH: process.env.DATA_PATH,
    SESSION_SECRET: process.env.SESSION_SECRET,
  };
  process.env.APP_ENV = 'test';
  process.env.DATA_PATH = dataPath;
  process.env.SESSION_SECRET = 'shutdown-test-secret-0123456789abcdef012345';
  clearHolder();
});

afterEach(async () => {
  clearHolder();
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(dataPath, { recursive: true, force: true });
});

describe('Datenbank beim Beenden', () => {
  it('überträgt die WAL-Datei in die Hauptdatei, wenn der Prozess endet', async () => {
    const before = new Set(process.listeners('exit'));
    const { getDeps } = await import('@/lib/deps');
    const deps = getDeps();
    deps.sqlite.exec(`CREATE TABLE ${MARKER} (x)`);
    const wal = `${deps.databasePath}-wal`;
    expect(existsSync(wal)).toBe(true);

    const added = process.listeners('exit').filter((listener) => !before.has(listener));
    expect(added).toHaveLength(1);
    added[0]!(143);

    expect(existsSync(wal)).toBe(false);
    const { sqlite } = openDatabase(deps.databasePath);
    try {
      expect(sqlite.prepare('SELECT name FROM sqlite_master WHERE name = ?').get(MARKER)).toBeDefined();
    } finally {
      sqlite.close();
    }
  });

  it('meldet sich nur einmal je Prozess an, auch wenn die Deps neu entstehen', async () => {
    const { getDeps } = await import('@/lib/deps');
    getDeps();
    const count = process.listeners('exit').length;
    clearHolder();
    getDeps();
    expect(process.listeners('exit')).toHaveLength(count);
  });
});
