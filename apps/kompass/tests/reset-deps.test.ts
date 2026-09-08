import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clearDirectory } from '@/lib/clear-directory';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const workspace = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'reset-deps-'));
  dirs.push(dir);
  return dir;
};

/**
 * Im Container ist das Medienverzeichnis ein Einhängepunkt. Ein `rm` darauf
 * scheitert mit EACCES, und der Rücksetzpfad der E2E-Tests brach ab, bevor er
 * etwas tat — sichtbar erst, als dieselbe Suite gegen das Image lief.
 */
describe('clearDirectory', () => {
  it('empties a directory without removing it', () => {
    const dir = workspace();
    const media = path.join(dir, 'media');
    mkdirSync(path.join(media, 'assets'), { recursive: true });
    writeFileSync(path.join(media, 'assets', 'foto.jpg'), 'x');
    writeFileSync(path.join(media, 'lose.bin'), 'y');

    clearDirectory(media);

    expect(existsSync(media)).toBe(true);
    expect(readdirSync(media)).toEqual([]);
  });

  it('creates the directory when it is not there yet', () => {
    const dir = workspace();
    const media = path.join(dir, 'media');
    clearDirectory(media);
    expect(existsSync(media)).toBe(true);
  });
});
