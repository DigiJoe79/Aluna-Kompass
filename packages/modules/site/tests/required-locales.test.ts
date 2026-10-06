import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { coreModule, previewLocaleRemoval, removeLocale, setModuleEnabled, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { siteModule } from '../src/manifest';
import { applyTemplateSync } from '../src/service';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const TEMPLATE = `
import { defineTemplate, text } from '@kompass/site-template';
export default defineTemplate({ name: 'Basis', locales: ['de', 'en'], variables: { claim: text({ localized: true, label: 'Claim' }) }, collections: {} });`;

async function installation(enableSite = true) {
  const deps = createTestDeps({ locales: ['de', 'en'], manifests: [coreModule, siteModule] });
  insertUser(deps, { id: 'USER-TEST' });
  if (enableSite) unwrap(await setModuleEnabled(deps, ctxWith(['modules.manage']), { key: 'site', enabled: true }));
  const dir = mkdtempSync(path.join(tmpdir(), 'kompass-req-'));
  dirs.push(dir);
  writeFileSync(path.join(dir, 'kompass.template.ts'), TEMPLATE);
  return { deps, dir };
}

describe('Webseite: Sprachen des Templates sind Pflicht', () => {
  it('ohne Template verlangt das Modul nichts', async () => {
    const { deps } = await installation();
    expect(siteModule.requiredLocales?.(deps)).toEqual([]);
    expect(unwrap(await removeLocale(deps, ctxWith(['settings.manage']), { code: 'en', confirm: true }))).toEqual(['de']);
  });

  it('mit Template liefert der Haken dessen Sprachen, Vorschau und Entfernen lehnen ab', async () => {
    const { deps, dir } = await installation();
    unwrap(await applyTemplateSync(deps, ctxWith(['site.manage']), { dir, confirm: true }));
    expect(siteModule.requiredLocales?.(deps)).toEqual(['de', 'en']);
    const ctx = ctxWith(['settings.manage']);
    for (const res of [await previewLocaleRemoval(deps, ctx, { code: 'en' }), await removeLocale(deps, ctx, { code: 'en', confirm: true })]) {
      expect(res.ok === false && res.error.type === 'conflict' && res.error.code === 'localeRequired' && res.error.params?.module === 'site').toBe(true);
    }
  });

  it('ist das Modul ausgeschaltet, zählt das Template nicht', async () => {
    const { deps, dir } = await installation();
    unwrap(await applyTemplateSync(deps, ctxWith(['site.manage']), { dir, confirm: true }));
    unwrap(await setModuleEnabled(deps, ctxWith(['modules.manage']), { key: 'site', enabled: false }));
    expect(unwrap(await removeLocale(deps, ctxWith(['settings.manage']), { code: 'en', confirm: true }))).toEqual(['de']);
  });
});
