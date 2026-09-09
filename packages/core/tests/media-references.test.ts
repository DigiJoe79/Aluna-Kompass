import { describe, expect, it } from 'vitest';
import { coreModule } from '../src/core-module';
import { defineModule } from '../src/modules/manifest';
import { createProject } from '../src/projects/service';
import { unwrap } from '../src/result';
import { setSetting } from '../src/settings/service';
import { findMediaReferences } from '../src/media/references';
import { storeMediaAsset } from '../src/media/service';
import { createTestDeps, ctxWith, insertUser } from '../src/testing';

const PNG = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'),
);
const OTHER_PNG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2"/></svg>');

describe('findMediaReferences', () => {
  it('reports the club logo, a project image and no false positives', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload', 'settings.manage', 'projects.manage'], insertUser(deps, {}));
    const logo = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'logo.png', bytes: PNG }));
    const other = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'other.svg', bytes: OTHER_PNG, declaredMimeType: 'image/svg+xml' }));

    unwrap(await setSetting(deps, ctx, { key: 'branding.logoAssetId', value: logo.id }));
    unwrap(await createProject(deps, ctx, { slug: 'hof', name: { de: 'Hofprojekt' }, type: 'ongoing', summary: { de: '' }, body: { de: '' }, imageAssetId: logo.id }));

    const hits = findMediaReferences(deps, logo.id);
    expect(hits.map((h) => h.entity).sort()).toEqual(['project', 'setting']);
    expect(hits.find((h) => h.entity === 'setting')!.label).toBe('Logo des Vereins');
    expect(hits.find((h) => h.entity === 'project')!.label).toBe('Projekt „hof"');
    expect(findMediaReferences(deps, other.id)).toEqual([]);
  });

  it('does not consult a disabled module', () => {
    const probe = defineModule({
      key: 'probe',
      version: '0.0.0',
      permissions: [],
      mediaReferences: () => [{ label: 'X', entity: 'probe', id: 'p1' }],
    });
    const deps = createTestDeps({ manifests: [coreModule, probe] });
    expect(findMediaReferences(deps, 'anything')).toEqual([]);
  });
});
