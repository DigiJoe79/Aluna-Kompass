import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { coreModule, defineModule, definePublishedView, setModuleEnabled, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { exportSiteContent, siteContentHash } from '../src/export';
import { siteModule } from '../src/manifest';
import { applyTemplateSync } from '../src/service';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = (prefix: string) => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

const TEMPLATE = `
import { defineTemplate } from '@kompass/site-template';
export default defineTemplate({ name: 'X', locales: ['de'], uses: ['berichte'], variables: {}, collections: {} });`;

const PDF = new TextEncoder().encode('%PDF-1.4 Bericht');

/** Ein Fachmodul mit einer Sicht, deren Zeile auf eine eigene Datei zeigt — wie die Jahresrechnung der Finanzen. */
function setup() {
  let reads = 0;
  const reports = defineModule({
    key: 'berichte',
    version: '1',
    permissions: [],
    publishedViews: [definePublishedView({ name: 'reports', schema: z.object({ year: z.string(), pdfAssetId: z.string() }), load: () => [{ year: '2026', pdfAssetId: 'berichte.R1' }] })],
    publishedFile: (_deps, id) => (id === 'berichte.R1' ? { id, filename: 'bericht-2026-r1.pdf', mimeType: 'application/pdf', read: async () => (reads++, PDF) } : null),
  });
  const deps = createTestDeps({ locales: ['de'], manifests: [coreModule, reports, siteModule] });
  insertUser(deps, { id: 'USER-TEST' });
  return { deps, reports, reads: () => reads };
}

describe('Dateien aus Modulen im Export', () => {
  it('legt die Datei ins Verzeichnis der Assets und nennt sie als PDF; der Hash liest sie nicht', async () => {
    const { deps, reads } = setup();
    const admin = ctxWith(['modules.manage', 'site.manage', 'site.publish']);
    for (const key of ['site', 'berichte']) unwrap(await setModuleEnabled(deps, admin, { key, enabled: true }));
    const dir = tmp('kompass-mf-tpl-');
    writeFileSync(path.join(dir, 'kompass.template.ts'), TEMPLATE);
    unwrap(await applyTemplateSync(deps, admin, { dir, confirm: true }));

    const hash = unwrap(await siteContentHash(deps, admin, { templateDir: dir }));
    expect(reads()).toBe(0);
    const jobDir = tmp('kompass-mf-job-');
    const out = unwrap(await exportSiteContent(deps, admin, { jobDir, templateDir: dir }));
    expect(out.contentHash).toBe(hash.contentHash);
    const content = JSON.parse(readFileSync(path.join(jobDir, 'content.json'), 'utf8'));
    expect(content.views.reports).toEqual([{ year: '2026', pdfAssetId: 'berichte.R1' }]);
    expect(content.assets).toEqual([{ id: 'berichte.R1', filename: 'bericht-2026-r1.pdf', mimeType: 'application/pdf', width: null, height: null }]);
    expect(readFileSync(path.join(jobDir, 'assets', 'bericht-2026-r1.pdf'))).toEqual(Buffer.from(PDF));
  });
});
