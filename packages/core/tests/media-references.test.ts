import { describe, expect, it } from 'vitest';
import { coreModule } from '../src/core-module';
import { defineModule } from '../src/modules/manifest';
import { unwrap } from '../src/result';
import { findMediaReferences, findMediaReferencesFor } from '../src/media/references';
import { setSetting, writeSettingInternal } from '../src/settings/service';
import { storeMediaAsset } from '../src/media/service';
import { createTestDeps, ctxWith, insertUser } from '../src/testing';

const PNG = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'),
);
const OTHER_PNG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2"/></svg>');

describe('findMediaReferences', () => {
  it('reports the club logo and no false positives', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload', 'settings.manage'], insertUser(deps, {}));
    const logo = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'logo.png', bytes: PNG }));
    const other = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'other.svg', bytes: OTHER_PNG, declaredMimeType: 'image/svg+xml' }));

    unwrap(await setSetting(deps, ctx, { key: 'branding.logoAssetId', value: logo.id }));

    const hits = findMediaReferences(deps, logo.id);
    expect(hits.map((h) => h.entity)).toEqual(['setting']);
    expect(hits.find((h) => h.entity === 'setting')!.label).toBe('Logo des Vereins');
    expect(hits[0]!.href).toBe('/admin/settings');
    expect(findMediaReferences(deps, other.id)).toEqual([]);
  });

  it('does not consult a disabled module', () => {
    const probe = defineModule({
      key: 'probe',
      version: '0.0.0',
      permissions: [],
      mediaReferences: () => [{ assetId: 'anything', label: 'X', entity: 'probe', id: 'p1' }],
    });
    const deps = createTestDeps({ manifests: [coreModule, probe] });
    expect(findMediaReferences(deps, 'anything')).toEqual([]);
  });
});

describe('findMediaReferencesFor', () => {
  it('asks each module once for a whole list and sorts the hits by asset', () => {
    const calls: string[][] = [];
    const probe = defineModule({
      key: 'probe',
      version: '0.0.0',
      permissions: [],
      mediaReferences: (_deps, assetIds) => {
        calls.push([...assetIds]);
        return [...assetIds].filter((id) => id !== 'C').map((id) => ({ assetId: id, label: `Probe ${id}`, entity: 'probe', id: `p-${id}` }));
      },
    });
    const deps = createTestDeps({ manifests: [coreModule, probe] });
    deps.db.transaction((tx) => {
      writeSettingInternal(tx, deps, ctxWith(['settings.manage']), 'modules.enabled', ['probe']);
    });

    const found = findMediaReferencesFor(deps, ['A', 'B', 'C', 'A']);
    expect(calls).toEqual([['A', 'B', 'C']]);
    expect(found.get('A')).toEqual([{ label: 'Probe A', entity: 'probe', id: 'p-A' }]);
    expect(found.get('B')).toEqual([{ label: 'Probe B', entity: 'probe', id: 'p-B' }]);
    expect(found.get('C')).toEqual([]);
    expect(findMediaReferences(deps, 'B')).toEqual([{ label: 'Probe B', entity: 'probe', id: 'p-B' }]);
  });
});
