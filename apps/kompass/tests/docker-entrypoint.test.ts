import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = path.resolve(import.meta.dirname, '../../../scripts/docker-entrypoint.sh');

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    chmodSync(dir, 0o700); // ohne Schreibrecht ließe sich das Verzeichnis sonst nicht mehr aufräumen
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Befundliste 0.2.0, N10: `createFileStore.write` legt eine Modul-Ablage
 * erst beim ersten Schreiben an; gehört `DATA_PATH` nicht der Container-UID
 * (auf dem NAS: root statt 1000), scheitert das `mkdir` mit einem stillen
 * `EACCES` erst beim ersten Upload. Der Entrypoint prüft `DATA_PATH` deshalb
 * schon vor dem Start auf Schreibbarkeit — mit einer klaren Meldung und
 * Exit ≠ 0, statt den Server erst hochzufahren.
 */
describe('docker-entrypoint.sh', () => {
  it('bricht mit einer klaren Meldung ab, wenn DATA_PATH nicht beschreibbar ist', () => {
    if (process.getuid?.() === 0) return; // root umgeht Schreibrechte — auf CI-Läufern ohne Bedeutung
    const dataPath = mkdtempSync(path.join(tmpdir(), 'kompass-entrypoint-'));
    dirs.push(dataPath);
    chmodSync(dataPath, 0o500);

    try {
      execFileSync('sh', [SCRIPT, 'true'], {
        env: { ...process.env, SESSION_SECRET: 'x'.repeat(32), DATA_PATH: dataPath, APP_ENV: 'test' },
        encoding: 'utf8',
      });
      expect.unreachable('der Entrypoint hätte abbrechen müssen');
    } catch (error) {
      const e = error as { status: number | null; stderr: string };
      expect(e.status).not.toBe(0);
      expect(e.stderr).toMatch(/Datenverzeichnis nicht beschreibbar/);
    }
  });
});
