import { createMediaFolder, storeMediaAsset, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { buildMediaListing, parseMediaListParams } from '@/lib/media-listing';

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2"/></svg>');

describe('parseMediaListParams', () => {
  it('maps the query string onto the filter: empty folder is root, omitted is all', () => {
    expect(parseMediaListParams(new URLSearchParams(''))).toEqual({});
    expect(parseMediaListParams(new URLSearchParams('folder='))).toEqual({ folder: null });
    expect(parseMediaListParams(new URLSearchParams('folder=Tiere%2F2026&query=rex&kind=image&sort=name'))).toEqual({ folder: 'Tiere/2026', query: 'rex', kind: 'image', sort: 'name' });
  });

  it('rejects unknown values', () => {
    expect(parseMediaListParams(new URLSearchParams('kind=video'))).toBeNull();
    expect(parseMediaListParams(new URLSearchParams('sort=random'))).toBeNull();
  });
});

describe('buildMediaListing', () => {
  it('returns items with usage and the folder list, and refuses without the permission', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload'], insertUser(deps, {}));
    unwrap(await createMediaFolder(deps, ctx, { path: 'Bilder' }));
    const a = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'a.png', bytes: PNG, folder: 'Bilder' }));
    unwrap(await storeMediaAsset(deps, ctx, { originalName: 'b.svg', bytes: SVG, declaredMimeType: 'image/svg+xml' }));

    const all = unwrap(await buildMediaListing(deps, ctx, {}));
    expect(all.items).toHaveLength(2);
    expect(all.folders).toEqual([{ path: 'Bilder', assetCount: 1 }]);
    const inFolder = unwrap(await buildMediaListing(deps, ctx, { folder: 'Bilder' }));
    expect(inFolder.items.map((i) => i.id)).toEqual([a.id]);
    expect(inFolder.items[0]).toMatchObject({ filename: a.filename, mimeType: 'image/png', folder: 'Bilder', references: [] });

    const denied = await buildMediaListing(deps, ctxWith([], 'someone'), {});
    expect(denied.ok === false && denied.error.type === 'forbidden').toBe(true);
  });
});
