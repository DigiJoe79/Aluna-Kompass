import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { coreModule } from '../src/core-module';
import { resetDataPath } from '../src/files/reset';
import { defineModule } from '../src/modules/manifest';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function tree(files: string[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'kompass-reset-'));
  dirs.push(dir);
  for (const file of files) {
    mkdirSync(path.join(dir, path.dirname(file)), { recursive: true });
    writeFileSync(path.join(dir, file), 'x');
  }
  return dir;
}

describe('resetDataPath', () => {
  const site = defineModule({ key: 'site', version: '0.0.1', permissions: [], files: true, providedFiles: ['template'] });
  const dms = defineModule({ key: 'dms', version: '0.0.1', permissions: [], files: true });

  it('verwirft den Bestand und behält, was der Verein bereitgestellt hat', async () => {
    const dir = tree([
      'core/db/kompass.db',
      'core/media/foto.png',
      'core/document-templates/eigene.typ',
      'site/template/kompass.template.ts',
      'site/cache-rest/alt.json',
      'dms/BRF-2026-001.pdf',
    ]);

    await resetDataPath(dir, [coreModule, site, dms]);

    expect(existsSync(path.join(dir, 'core', 'db', 'kompass.db'))).toBe(false);
    expect(existsSync(path.join(dir, 'core', 'media', 'foto.png'))).toBe(false);
    expect(existsSync(path.join(dir, 'dms', 'BRF-2026-001.pdf'))).toBe(false);
    expect(existsSync(path.join(dir, 'site', 'cache-rest', 'alt.json'))).toBe(false);

    // Bereitgestellt, nicht erzeugt: bleibt liegen.
    expect(existsSync(path.join(dir, 'core', 'document-templates', 'eigene.typ'))).toBe(true);
    expect(existsSync(path.join(dir, 'site', 'template', 'kompass.template.ts'))).toBe(true);
  });

  /**
   * Im Container ist `dataPath` ein Einhängepunkt. Ein `rm` darauf scheitert
   * mit EACCES, und der Rücksetzpfad der E2E-Tests brach ab, bevor er etwas
   * tat — sichtbar erst, als dieselbe Suite gegen das Image lief. Deshalb wird
   * die Wurzel geleert, nie entfernt.
   */
  it('leert die Wurzel, ohne sie zu entfernen', async () => {
    const dir = tree(['core/db/kompass.db']);
    await resetDataPath(dir, [coreModule]);
    expect(existsSync(dir)).toBe(true);
    // `core` bleibt als leere Hülle stehen — es ist das Elternverzeichnis der
    // geschützten Basis-Vorlagen. Der Bestand darin ist weg.
    expect(readdirSync(dir)).toEqual(['core']);
    expect(existsSync(path.join(dir, 'core', 'db'))).toBe(false);
  });

  it('kommt mit einem leeren oder fehlenden Verzeichnis zurecht', async () => {
    const dir = tree([]);
    await expect(resetDataPath(dir, [coreModule])).resolves.toBeUndefined();
    await expect(resetDataPath(path.join(dir, 'gibtsnicht'), [coreModule])).resolves.toBeUndefined();
  });
});
