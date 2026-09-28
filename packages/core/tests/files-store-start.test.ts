import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDeps } from '../src/app';
import { defineModule } from '../src/modules/manifest';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'kompass-files-start-'));
  dirs.push(dir);
  return dir;
}

/**
 * Befundliste 0.2.0, N10: `createFileStore.write` legt eine Modul-Ablage
 * erst beim ersten Schreiben an (`mkdir` in `store.ts`); fehlt dem
 * Datenverzeichnis das Schreibrecht (auf dem NAS: `data/` gehört root statt
 * UID 1000), scheitert dieses `mkdir` mit `EACCES` erst beim ersten Upload,
 * mit einem stillen 500 in der Oberfläche. Der Start soll das vorher merken:
 * `createDeps` legt die Ablagen aller Module mit `files: true` gleich an und
 * prüft sie auf Schreibbarkeit — wer keine hat, bricht mit einer Meldung ab,
 * die den Pfad nennt, statt erst beim ersten Beleg zu scheitern.
 */
describe('createDeps prüft die Dateiablagen beim Start (N10)', () => {
  it('legt beim Start die Ablagen aller Module mit files:true (und die Mediathek) an', () => {
    const dir = tempDir();
    const storing = defineModule({ key: 'ablage', version: '0.0.1', permissions: [], files: true });
    const deps = createDeps({ dataPath: dir, env: 'test', modules: [storing] });
    expect(existsSync(path.join(dir, 'ablage'))).toBe(true);
    expect(existsSync(path.join(dir, 'core', 'media'))).toBe(true);
    deps.close();
  });

  it('bricht ab, wenn DATA_PATH nicht beschreibbar ist, und nennt den Pfad', () => {
    if (process.getuid?.() === 0) return; // root umgeht Schreibrechte — auf CI-Läufern ohne Bedeutung
    const dir = tempDir();
    const readonly = path.join(dir, 'gesperrt');
    // `data/` selbst existiert schon (wie im Betrieb, wo der Ordner vor dem Container angelegt wird), nur ohne Schreibrecht.
    mkdirSync(readonly, { recursive: true });
    chmodSync(readonly, 0o500);
    const storing = defineModule({ key: 'ablage', version: '0.0.1', permissions: [], files: true });
    try {
      expect(() => createDeps({ dataPath: readonly, env: 'test', modules: [storing] })).toThrow(readonly);
    } finally {
      chmodSync(readonly, 0o700);
    }
  });
});
