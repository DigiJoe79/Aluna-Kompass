import { storeMediaAsset, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { projectsMediaReferences } from '../src/references';
import { createProject } from '../src/service';

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
// Gleiche Bytes ergeben dasselbe Asset — der Fremde braucht andere.
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2"/></svg>');

describe('projectsMediaReferences', () => {
  it('names the project that uses an image, and nothing for a stranger', async () => {
    const deps = createTestDeps();
    const ctx = ctxWith(['media.upload', 'projects.manage'], insertUser(deps, {}));
    const asset = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'hof.png', bytes: PNG }));
    const other = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'x.svg', bytes: SVG, declaredMimeType: 'image/svg+xml' }));
    unwrap(await createProject(deps, ctx, { slug: 'hof', name: { de: 'Hof' }, type: 'ongoing', summary: { de: '' }, body: { de: '' }, imageAssetId: asset.id }));
    const hits = projectsMediaReferences(deps, asset.id);
    expect(hits).toEqual([{ label: 'Projekt „hof“', entity: 'project', id: expect.any(String), href: expect.stringMatching(/^\/projects\/[0-9A-Z]{26}$/) }]);
    expect(hits[0]!.href).toBe(`/projects/${hits[0]!.id}`);
    expect(projectsMediaReferences(deps, other.id)).toEqual([]);
  });
});
