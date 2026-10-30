import { coreModule, defineModule, definePublishedView, publishedItemLiveSince, setModuleEnabled, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { publishedLiveSinceInternal } from '../src/live-since';
import { siteModule } from '../src/manifest';
import { currentContentManifest } from '../src/pending';
import { applyTemplateSync } from '../src/service';
import { recordPublish } from '../src/services/publishes';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const TEMPLATE = `
import { defineTemplate } from '@kompass/site-template';
export default defineTemplate({ name: 'X', locales: ['de'], uses: ['berichte'], variables: {}, collections: {} });`;
const none = { changed: [], added: [], removed: [] };
const admin = ctxWith(['modules.manage', 'site.manage', 'site.publish']);

async function setup() {
  const rows: { year: string; title: string }[] = [];
  const reports = defineModule({
    key: 'berichte',
    version: '1',
    permissions: [],
    publishedViews: [definePublishedView({ name: 'reports', schema: z.object({ year: z.string(), title: z.string() }), load: () => rows, editLink: (_d, row) => ({ href: `/reports/${row.year}`, title: row.title }) })],
  });
  const deps = createTestDeps({ locales: ['de'], manifests: [coreModule, reports, siteModule] });
  insertUser(deps, { id: 'USER-TEST' });
  for (const key of ['site', 'berichte']) unwrap(await setModuleEnabled(deps, admin, { key, enabled: true }));
  const dir = mkdtempSync(path.join(tmpdir(), 'kompass-ls-tpl-'));
  dirs.push(dir);
  writeFileSync(path.join(dir, 'kompass.template.ts'), TEMPLATE);
  unwrap(await applyTemplateSync(deps, admin, { dir, confirm: true }));
  let day = 0;
  const stamp = (opts: { environment?: string; status?: 'success' | 'failed' } = {}) => {
    const startedAt = `2026-10-${String(++day).padStart(2, '0')}T08:00:00.000Z`;
    recordPublish(deps, admin, { environment: opts.environment ?? 'production', startedAt, status: opts.status ?? 'success', contentHash: 'h', diff: none, fileManifest: {}, log: '', summary: 's', contentManifest: currentContentManifest(deps) });
    return startedAt;
  };
  return { deps, rows, stamp };
}

describe('Publiziert seit — je Zeile einer Sicht', () => {
  it('ist null ohne Publish und ohne Zeile', async () => {
    const { deps, rows } = await setup();
    expect(publishedLiveSinceInternal(deps, 'reports', '/reports/2026')).toBeNull();
    rows.push({ year: '2026', title: 'Bericht 2026' });
    expect(publishedLiveSinceInternal(deps, 'reports', '/reports/2026')).toBeNull();
  });

  it('nennt den ältesten Publish der Produktion, seit dem die Zeile unverändert online ist', async () => {
    const { deps, rows, stamp } = await setup();
    stamp();
    rows.push({ year: '2026', title: 'Bericht 2026' });
    const first = stamp();
    stamp({ environment: 'test' });
    stamp({ status: 'failed' });
    stamp();
    expect(publishedLiveSinceInternal(deps, 'reports', '/reports/2026')).toBe(first);
    expect(publishedItemLiveSince(deps, 'reports', '/reports/2026')).toBe(first);
  });

  it('ist null, sobald die Zeile nach dem Publish geändert wurde, und beginnt mit dem nächsten neu', async () => {
    const { deps, rows, stamp } = await setup();
    rows.push({ year: '2026', title: 'Bericht 2026' });
    stamp();
    rows[0]!.title = 'Bericht 2026 (berichtigt)';
    expect(publishedLiveSinceInternal(deps, 'reports', '/reports/2026')).toBeNull();
    const again = stamp();
    expect(publishedLiveSinceInternal(deps, 'reports', '/reports/2026')).toBe(again);
  });
});
