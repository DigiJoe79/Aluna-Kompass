import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureModuleResolution, loadTemplate, resolveTemplateNodeModules, resolveTemplatePackage } from '../src/load';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const withTemplate = async (source: string) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kompass-tpl-'));
  dirs.push(dir);
  writeFileSync(path.join(dir, 'kompass.template.ts'), source);
  // Ohne Modulauflösung findet Node @kompass/site-template nicht.
  await ensureModuleResolution(dir);
  return dir;
};

const GOOD = `
import { defineTemplate, text } from '@kompass/site-template';
export default defineTemplate({
  name: 'Probe', locales: ['de'],
  variables: { claim: text({ max: 40, localized: true, label: 'Claim' }) },
  collections: { notes: { label: 'Notizen', fields: { body: text({ label: 'Text' }) } } },
});`;

describe('loadTemplate', () => {
  it('reads the declaration and derives a checksum', async () => {
    const result = await loadTemplate(await withTemplate(GOOD));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.definition.name).toBe('Probe');
    expect(result.value.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(result.value.schema.variables.claim!.widget).toBe('localized');
  });

  it('gives the same checksum for the same file and a different one after an edit', async () => {
    const dir = await withTemplate(GOOD);
    const first = await loadTemplate(dir);
    const again = await loadTemplate(dir);
    expect(first.ok && again.ok && first.value.checksum === again.value.checksum).toBe(true);
  });

  it('reports a directory without module resolution as its own conflict', async () => {
    const bare = mkdtempSync(path.join(tmpdir(), 'kompass-bare-'));
    dirs.push(bare);
    writeFileSync(path.join(bare, 'kompass.template.ts'), GOOD);
    const result = await loadTemplate(bare);
    expect(result.ok === false && result.error.type === 'conflict' && result.error.code === 'templateResolutionMissing').toBe(true);
  });

  it('reports a missing file, a broken file and a wrong export as conflicts', async () => {
    const missing = await loadTemplate(mkdtempSync(path.join(tmpdir(), 'kompass-empty-')));
    expect(missing.ok === false && missing.error.type === 'conflict' && missing.error.code === 'templateMissing').toBe(true);
    const broken = await loadTemplate(await withTemplate('export default {'));
    expect(broken.ok === false && broken.error.type === 'conflict' && broken.error.code === 'templateUnreadable').toBe(true);
    const wrong = await loadTemplate(await withTemplate('export default { hallo: 1 };'));
    expect(wrong.ok === false && wrong.error.type === 'conflict' && wrong.error.code === 'templateInvalid').toBe(true);
  });
});

describe('resolving node_modules', () => {
  /**
   * Turbopack ersetzt `import.meta.url` beim Bündeln durch eine Modul-ID. Ein
   * `createRequire` darauf wirft im Container „path must be of type string,
   * received number" — im Dev-Modus nie, weil dort nicht gebündelt wird.
   */
  it('finds the package without relying on import.meta.url', () => {
    const found = resolveTemplatePackage();
    expect(found.endsWith('site-template')).toBe(true);
    expect(existsSync(path.join(found, 'package.json'))).toBe(true);
  });

  it('says what is missing instead of failing on a type', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kompass-noresolve-'));
    dirs.push(dir);
    // Auflösung von einem Ort aus, an dem es das Paket nicht gibt.
    await expect(ensureModuleResolution(dir, '/nirgendwo')).rejects.toThrow(/site-template/);
  });
});

describe('the node_modules a template needs', () => {
  /**
   * pnpm installiert nicht flach: `astro` liegt nicht in der Wurzel, sondern
   * bei dem Paket, das es braucht. Ein Symlink auf `/app/node_modules` findet
   * deshalb `@kompass/site-template`, aber kein Astro — und der Build bricht
   * mit „astro not installed".
   */
  it('points at a directory that actually holds astro', () => {
    const dir = resolveTemplateNodeModules();
    expect(existsSync(path.join(dir, 'astro')), `${dir} führt kein astro`).toBe(true);
    expect(existsSync(path.join(dir, '@kompass', 'site-template'))).toBe(true);
  });
});

describe('an existing module resolution', () => {
  /**
   * Der Symlink überlebt Neustarts und Updates. Zeigt er noch auf eine ältere,
   * falsche node_modules, scheitert jeder Build mit „astro not installed", und
   * niemand kommt darauf, ihn von Hand zu löschen.
   */
  it('repairs a symlink whose target holds no astro', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kompass-stale-'));
    const stale = mkdtempSync(path.join(tmpdir(), 'kompass-empty-nm-'));
    dirs.push(dir, stale);
    await symlink(stale, path.join(dir, 'node_modules'), 'dir');
    await ensureModuleResolution(dir);
    expect(realpathSync(path.join(dir, 'node_modules'))).toBe(realpathSync(resolveTemplateNodeModules()));
  });

  it('leaves a real directory alone', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kompass-own-nm-'));
    dirs.push(dir);
    mkdirSync(path.join(dir, 'node_modules'));
    await ensureModuleResolution(dir);
    expect(lstatSync(path.join(dir, 'node_modules')).isSymbolicLink()).toBe(false);
  });
});

describe('a template that brings its own node_modules', () => {
  /**
   * Wer sein Template lokal entwickelt, hat dort ein `pnpm install` laufen und
   * lädt den Ordner mitsamt `node_modules` hoch. pnpm legt eine
   * `file:`-Abhängigkeit als Kopie ab — `@kompass/site-template` liegt dann als
   * TypeScript unter `node_modules`, und Node weigert sich dort, Typen zu
   * entfernen: „Stripping types is currently unsupported for files under
   * node_modules". Über einen Symlink löst Node den echten Pfad auf, der
   * ausserhalb liegt, und lädt.
   */
  it('replaces a copied contract package with a link to the running one', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kompass-own-nm-'));
    dirs.push(dir);
    const own = path.join(dir, 'node_modules');
    mkdirSync(path.join(own, '@kompass', 'site-template', 'src'), { recursive: true });
    writeFileSync(path.join(own, '@kompass', 'site-template', 'package.json'), JSON.stringify({ name: '@kompass/site-template', type: 'module', exports: { '.': './src/index.ts' } }));
    writeFileSync(path.join(own, '@kompass', 'site-template', 'src', 'index.ts'), 'export const stale: number = 1;\n');
    writeFileSync(path.join(dir, 'kompass.template.ts'), GOOD);

    await ensureModuleResolution(dir);

    const linked = path.join(own, '@kompass', 'site-template');
    expect(lstatSync(linked).isSymbolicLink()).toBe(true);
    expect(realpathSync(linked)).toBe(realpathSync(resolveTemplatePackage()));
    const result = await loadTemplate(dir);
    expect(result.ok === true && result.value.definition.name === 'Probe').toBe(true);
  });

  it('keeps the rest of that node_modules untouched', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kompass-own-nm2-'));
    dirs.push(dir);
    const own = path.join(dir, 'node_modules');
    mkdirSync(path.join(own, 'astro'), { recursive: true });
    writeFileSync(path.join(own, 'astro', 'marker.txt'), 'vom Verein installiert');

    await ensureModuleResolution(dir);

    expect(lstatSync(own).isSymbolicLink()).toBe(false);
    expect(readFileSync(path.join(own, 'astro', 'marker.txt'), 'utf8')).toBe('vom Verein installiert');
  });
});
