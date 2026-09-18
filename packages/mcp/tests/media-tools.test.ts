import { coreModule, getMediaAsset, schema, storeMediaAsset, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { coreMcpTools } from '../src/core-tools';

const tool = (name: string) => {
  const found = coreMcpTools.find((t) => t.name === name);
  if (!found) throw new Error(`kein Werkzeug ${name}`);
  return found;
};

/** Ein 1×1-PNG, wie es auch `packages/modules/animals/tests/animals.test.ts` benutzt. */
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const setup = () => {
  const deps = createTestDeps({ manifests: [coreModule] });
  insertUser(deps, { id: 'USER-TEST' });
  return deps;
};

describe('media_upload', () => {
  it('is registered, names its service and the permission', () => {
    expect(tool('media_upload').service).toBe(storeMediaAsset);
    expect(tool('media_upload').description).toContain('media.upload');
  });

  it('stores a base64 file through the service and reads it back', async () => {
    const deps = setup();
    const ctx = ctxWith(['media.upload']);
    const result = await tool('media_upload').handler(deps, ctx, { filename: 'punkt.png', contentBase64: PNG_BASE64 });
    const record = unwrap(result) as { id: string; mimeType: string; bytes: number; folder: string | null };
    expect(record).toMatchObject({ mimeType: 'image/png', bytes: 70, folder: null });
    const stored = unwrap(await getMediaAsset(deps, ctx, record.id));
    expect(Buffer.from(stored.bytes).toString('base64')).toBe(PNG_BASE64);
    expect(deps.db.select().from(schema.auditLog).all().at(-1)).toMatchObject({ action: 'media.upload', entityId: record.id, channel: ctx.channel });
  });

  it('returns the existing record when the same bytes are uploaded again', async () => {
    const deps = setup();
    const ctx = ctxWith(['media.upload']);
    const first = unwrap(await tool('media_upload').handler(deps, ctx, { filename: 'a.png', contentBase64: PNG_BASE64 })) as { id: string; filename: string };
    const second = unwrap(await tool('media_upload').handler(deps, ctx, { filename: 'b.png', contentBase64: PNG_BASE64 })) as { id: string; filename: string };
    expect(second.id).toBe(first.id);
    expect(second.filename).toBe(first.filename);
  });

  it('rejects text that is not base64 as a validation error, before touching the service', async () => {
    const deps = setup();
    const result = await tool('media_upload').handler(deps, ctxWith(['media.upload']), { filename: 'x.png', contentBase64: 'das ist kein base64!' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('validation');
      expect(result.error.type === 'validation' && result.error.issues[0]).toMatchObject({ path: 'contentBase64', message: 'invalidBase64' });
    }
    expect(deps.db.select().from(schema.mediaAssets).all()).toHaveLength(0);
  });

  it('leaves the size limit to the service', async () => {
    const deps = setup();
    const tooBig = Buffer.alloc(10 * 1024 * 1024 + 1, 1).toString('base64');
    const result = await tool('media_upload').handler(deps, ctxWith(['media.upload']), { filename: 'gross.bin', contentBase64: tooBig });
    expect(result.ok === false && result.error.type === 'validation' && result.error.issues[0]?.message).toBe('fileTooLarge');
  });

  it('is forbidden without media.upload', async () => {
    const deps = setup();
    const result = await tool('media_upload').handler(deps, ctxWith([]), { filename: 'x.png', contentBase64: PNG_BASE64 });
    expect(result.ok === false && result.error.type).toBe('forbidden');
  });
});

describe('media_list', () => {
  it('shows the four filter fields and passes them to the service', async () => {
    const deps = setup();
    const ctx = ctxWith(['media.upload']);
    const shape = (tool('media_list').inputSchema as unknown as { shape: Record<string, unknown> }).shape;
    expect(Object.keys(shape).sort()).toEqual(['folder', 'kind', 'query', 'sort']);
    expect(tool('media_list').description).toContain('media.upload');

    await tool('media_upload').handler(deps, ctx, { filename: 'punkt.png', contentBase64: PNG_BASE64 });
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2"/></svg>').toString('base64');
    await tool('media_upload').handler(deps, ctx, { filename: 'zeichen.svg', contentBase64: svg });

    const all = unwrap(await tool('media_list').handler(deps, ctx, {})) as { record: { filename: string } }[];
    expect(all).toHaveLength(2);
    const found = unwrap(await tool('media_list').handler(deps, ctx, { query: 'punkt' })) as { record: { filename: string } }[];
    expect(found.map((m) => m.record.filename)).toEqual([expect.stringMatching(/^punkt-/)]);
    const byName = unwrap(await tool('media_list').handler(deps, ctx, { sort: 'name' })) as { record: { filename: string } }[];
    expect(byName.map((m) => m.record.filename.split('-')[0])).toEqual(['punkt', 'zeichen']);
  });
});
