import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { coreModule, setModuleEnabled, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { projectsModule } from '@kompass/module-projects';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** Was in `content.json` landet — der Ordner `job` ist nach dem Bau weg. */
const written = vi.hoisted(() => ({ content: [] as string[] }));
vi.mock('node:fs/promises', async (orig) => {
  const real = await orig<typeof import('node:fs/promises')>();
  return {
    ...real,
    writeFile: (async (file: Parameters<typeof real.writeFile>[0], data: Parameters<typeof real.writeFile>[1], ...rest: unknown[]) => {
      if (String(file).endsWith('content.json')) written.content.push(String(data));
      return (real.writeFile as (...a: unknown[]) => Promise<void>)(file, data, ...rest);
    }) as typeof real.writeFile,
  };
});
import { applyTemplateSync, buildSinglePage, readPublicContent, siteModule, singlePageRoot } from '../src';
import { activeTemplate } from '../src/service';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kompass-single-'));
  dirs.push(d);
  return d;
};
const TEMPLATE_DIR = path.resolve(import.meta.dirname, '../../../../templates/verein-basis');
const htmlWith = (dir: string, text: string): boolean =>
  readdirSync(dir, { recursive: true, withFileTypes: true }).some((e) => e.isFile() && e.name.endsWith('.html') && readFileSync(path.join(e.parentPath, e.name), 'utf8').includes(text));

/**
 * Vorschau einer einzelnen Zeile (Spike Plan B: Bau in Sekunden): eigene Zeile einer Sicht, eigener Ordner unter
 * `site-single`, ohne die Sperre der Läufe und ohne `previewDir`/`cacheDir` der normalen Läufe anzufassen.
 * Mit `verein-basis` und der Sicht `organization` (Name im Seitenfuß) — die Tierseite gibt es nur in Vorlagen von Vereinen.
 */
describe('buildSinglePage', () => {
  it('builds the site with one row of a view in its own directory, fast, and leaves the normal runs alone', async () => {
    const deps = createTestDeps({ manifests: [coreModule, projectsModule, siteModule], locales: ['de', 'en'] });
    insertUser(deps, { id: 'USER-TEST' });
    unwrap(await setModuleEnabled(deps, ctxWith(['modules.manage']), { key: 'projects', enabled: true }));
    unwrap(await applyTemplateSync(deps, ctxWith(['site.manage', 'site.view']), { dir: TEMPLATE_DIR, confirm: true }));
    const row = { ...(unwrap(readPublicContent(deps, activeTemplate(deps)!)).views.organization![0] as Record<string, unknown>), name: 'Einzelvorschau Verein' };

    const base = tmp();
    const env = { publicUrl: 'https://example.org', staging: true, deploy: null, templateDir: TEMPLATE_DIR, cacheDir: path.join(base, 'site-build'), previewDir: path.join(base, 'site-preview') };
    const built = unwrap(await buildSinglePage(deps, env, { view: 'organization', row, key: 'k1' }));
    expect(built.dir).toBe(path.join(singlePageRoot(env), 'k1', 'out'));
    expect(htmlWith(built.dir, 'Einzelvorschau Verein')).toBe(true);
    expect(built.ms).toBeLessThan(10_000);
    expect(existsSync(env.cacheDir)).toBe(false);
    expect(existsSync(env.previewDir)).toBe(false);

    const again = unwrap(await buildSinglePage(deps, env, { view: 'organization', row, key: 'k1' }));
    expect(again.cached).toBe(true);
    const other = unwrap(await buildSinglePage(deps, env, { view: 'organization', row: { ...row, name: 'Zweite Fassung' }, key: 'k2' }));
    expect(other.dir).not.toBe(built.dir);
    expect(htmlWith(other.dir, 'Zweite Fassung')).toBe(true);
    expect(htmlWith(built.dir, 'Einzelvorschau Verein')).toBe(true);

    // Zwei verschiedene Bauten zugleich (Heute/Mit Wahl umgeschaltet, zwei Prüfer): beide gelingen.
    const [a, b] = await Promise.all([
      buildSinglePage(deps, env, { view: 'organization', row: { ...row, name: 'Parallel A' }, key: 'p1' }),
      buildSinglePage(deps, env, { view: 'organization', row: { ...row, name: 'Parallel B' }, key: 'p2' }),
    ]);
    expect(htmlWith(unwrap(a).dir, 'Parallel A') && htmlWith(unwrap(b).dir, 'Parallel B')).toBe(true);
  }, 120_000);

  it('cuts languages the installation or the template does not have out of the row, like the public state', async () => {
    const deps = createTestDeps({ manifests: [coreModule, projectsModule, siteModule], locales: ['de', 'en'] });
    insertUser(deps, { id: 'USER-TEST' });
    unwrap(await setModuleEnabled(deps, ctxWith(['modules.manage']), { key: 'projects', enabled: true }));
    unwrap(await applyTemplateSync(deps, ctxWith(['site.manage', 'site.view']), { dir: TEMPLATE_DIR, confirm: true }));
    const row = { ...(unwrap(readPublicContent(deps, activeTemplate(deps)!)).views.organization![0] as Record<string, unknown>), motto: { de: 'Hallo', fr: 'Bonjour' } };
    const base = tmp();
    const env = { publicUrl: 'https://example.org', staging: true, deploy: null, templateDir: TEMPLATE_DIR, cacheDir: path.join(base, 'site-build'), previewDir: path.join(base, 'site-preview') };
    written.content = [];
    unwrap(await buildSinglePage(deps, env, { view: 'organization', row, key: 'locales1' }));
    const content = JSON.parse(written.content.at(-1)!) as { views: { organization: { motto: Record<string, string> }[] } };
    expect(content.views.organization[0]!.motto).toEqual({ de: 'Hallo' });
  }, 120_000);

  it('refuses a view the template does not use and a key that is not a plain name', async () => {
    const deps = createTestDeps({ manifests: [coreModule, projectsModule, siteModule], locales: ['de', 'en'] });
    insertUser(deps, { id: 'USER-TEST' });
    unwrap(await setModuleEnabled(deps, ctxWith(['modules.manage']), { key: 'projects', enabled: true }));
    unwrap(await applyTemplateSync(deps, ctxWith(['site.manage', 'site.view']), { dir: TEMPLATE_DIR, confirm: true }));
    const base = tmp();
    const env = { publicUrl: 'https://example.org', staging: true, deploy: null, templateDir: TEMPLATE_DIR, cacheDir: path.join(base, 'site-build'), previewDir: path.join(base, 'site-preview') };
    expect(await buildSinglePage(deps, env, { view: 'animals', row: {}, key: 'k1' })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'viewNotInTemplate' } });
    expect(await buildSinglePage(deps, env, { view: 'organization', row: {}, key: '../x' })).toMatchObject({ ok: false, error: { type: 'validation' } });
  });
});
