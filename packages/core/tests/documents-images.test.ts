import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { documentImageExtension, documentImagePath } from '../src/documents/images';
import { documentSnapshot, prepare } from '../src/documents/service';
import type { DocumentTemplate } from '../src/modules/manifest';
import { unwrap } from '../src/result';
import { createTestDeps, ctxWith } from '../src/testing';

/** 1×1-PNG und die ersten Bytes eines JPEG — mehr braucht die Erkennung nicht. */
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PDF = new TextEncoder().encode('%PDF-1.4');

const withImage: DocumentTemplate<{ key: string; kind: 'png' | 'pdf'; facsimile?: { bytes: Uint8Array; checksum: string } }> = {
  key: 'test-image',
  type: 'image',
  base: 'a4-plain',
  filed: false,
  schema: z.object({ key: z.string(), kind: z.enum(['png', 'pdf']), facsimile: z.object({ bytes: z.instanceof(Uint8Array), checksum: z.string() }).optional() }),
  build: (data) => ({
    slots: { kind: 'form', title: 'Bild' },
    body: { typst: `#image("${documentImagePath(data.key, data.kind === 'png' ? PNG : PDF)}")` },
    images: { [data.key]: { bytes: data.kind === 'png' ? PNG : PDF, checksum: `sha-${data.key}` } },
  }),
};

const setup = () => createTestDeps({ coreTemplates: [withImage] });

describe('document images', () => {
  it('prepare passes images through and snapshots only their checksums', async () => {
    const deps = setup();
    const prepared = unwrap(await prepare(deps, ctxWith([]), { templateKey: 'test-image', input: { key: 'signature', kind: 'png', facsimile: { bytes: PNG, checksum: 'sha-facsimile' } } }));
    expect(prepared.images).toEqual({ signature: { bytes: PNG, checksum: 'sha-signature' } });
    expect(prepared.bodyTypst).toBe('#image("/images/signature.png")');

    const snapshot = documentSnapshot(prepared);
    expect(snapshot.images).toEqual({ signature: 'sha-signature' });
    const json = JSON.stringify(snapshot);
    // Weder das Bild noch die Bytes in der Eingabe landen im Snapshot — nur Prüfsummen.
    expect(json).not.toContain('"0":137');
    expect(JSON.parse(json).input).toEqual({ key: 'signature', kind: 'png', facsimile: { checksum: 'sha-facsimile' } });
    expect(snapshot).toMatchObject({ base: 'a4-plain', baseChecksum: 'a'.repeat(64), slots: { kind: 'form', title: 'Bild' } });
  });

  it('leaves images out of the snapshot when a template has none, and prefers the caller snapshot for the input', async () => {
    const plain: DocumentTemplate<object> = { key: 'plain', type: 'plain', base: 'a4-plain', filed: false, schema: z.object({}), build: () => ({ slots: { kind: 'plain' }, body: { typst: 'x' } }) };
    const deps = createTestDeps({ coreTemplates: [plain] });
    const prepared = unwrap(await prepare(deps, ctxWith([]), { templateKey: 'plain', input: {} }));
    expect(prepared.images).toBeUndefined();
    const snapshot = documentSnapshot(prepared, { hash: 'abc' });
    expect(snapshot).toEqual({ input: { hash: 'abc' }, slots: { kind: 'plain' }, base: 'a4-plain', baseChecksum: 'a'.repeat(64) });
  });

  it('refuses an image key outside [a-z0-9-] and bytes that are neither png nor jpeg', async () => {
    const deps = setup();
    const badKey = await prepare(deps, ctxWith([]), { templateKey: 'test-image', input: { key: '../x', kind: 'png' } });
    expect(badKey.ok === false && badKey.error.type === 'conflict' && badKey.error.code === 'documentImageInvalid').toBe(true);
    const badBytes = await prepare(deps, ctxWith([]), { templateKey: 'test-image', input: { key: 'seal', kind: 'pdf' } });
    expect(badBytes.ok === false && badBytes.error.type === 'conflict' && badBytes.error.code === 'documentImageInvalid').toBe(true);
  });

  it('reads the file extension from the magic bytes, not from a name', () => {
    expect(documentImageExtension(PNG)).toBe('png');
    expect(documentImageExtension(JPEG)).toBe('jpg');
    expect(documentImageExtension(PDF)).toBeNull();
    expect(documentImagePath('signature', JPEG)).toBe('/images/signature.jpg');
  });
});
