import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { coreModule, setSetting, storeMediaAsset, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { createTeamMember, exportSiteContent, setTeamMemberPublished, updatePage, websiteModule } from '../src';

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const job = () => { const d = mkdtempSync(path.join(tmpdir(), 'kompass-site-')); dirs.push(d); return d; };
const manage = ctxWith(['website.manage', 'website.view', 'website.publish', 'settings.manage', 'media.upload']);

describe('exportSiteContent', () => {
  it('writes canonical content.json with all published views, copies referenced assets and hashes deterministically', async () => {
    const deps = createTestDeps({ manifests: [coreModule, websiteModule] });
    insertUser(deps, { id: 'USER-TEST' });
    unwrap(await setSetting(deps, manage, { key: 'i18n.locales', value: ['de', 'en'] }));
    const photo = unwrap(await storeMediaAsset(deps, manage, { originalName: 'nicole.png', bytes: PNG }));
    const m = unwrap(await createTeamMember(deps, manage, { name: 'Nicole', position: { de: 'Vorsitz', en: '' }, photoAssetId: photo.id }));
    unwrap(await setTeamMemberPublished(deps, manage, { id: m.id, isPublished: true }));
    const a = unwrap(await exportSiteContent(deps, manage, { jobDir: job() }));
    const b = unwrap(await exportSiteContent(deps, manage, { jobDir: job() }));
    expect(a.contentHash).toBe(b.contentHash);
    const content = JSON.parse(readFileSync(a.contentPath, 'utf8'));
    expect(Object.keys(content).sort()).toEqual(['articles', 'assets', 'downloads', 'facts', 'faqs', 'pages', 'projects', 'team']);
    expect(content.team[0].photoAssetId).toBe(photo.id);
    expect(a.assets.map((x) => x.id)).toEqual([photo.id]);
    expect(readFileSync(path.join(path.dirname(a.contentPath), 'assets', photo.filename)).byteLength).toBe(PNG.byteLength);
    expect(a.gaps).toEqual([{ collection: 'team', id: m.id, field: 'position' }]);
    expect(a.violations).toEqual([]);
  });

  it('reports blocked terms from settings and requires website.publish', async () => {
    const deps = createTestDeps({ manifests: [coreModule, websiteModule], locales: ['de', 'en'] });
    insertUser(deps, { id: 'USER-TEST' });
    unwrap(await setSetting(deps, manage, { key: 'website.blockedTerms', value: ['Popescu'] }));
    unwrap(await updatePage(deps, manage, { key: 'partners', body: { de: 'Frau Popescu betreibt den Shelter.', en: '' } }));
    const result = unwrap(await exportSiteContent(deps, manage, { jobDir: job() }));
    expect(result.violations).toEqual([{ path: 'pages[?].body.de', term: 'popescu', excerpt: expect.any(String) }].map((v) => ({ ...v, path: expect.stringMatching(/^pages\[\d+\]\.body\.de$/) })));
    expect((await exportSiteContent(deps, ctxWith(['website.manage']), { jobDir: job() })).ok).toBe(false);
  });
});
