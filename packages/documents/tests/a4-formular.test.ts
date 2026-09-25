import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DocumentRenderContext } from '@kompass/core';
import { DEFAULT_THEME } from '@kompass/core/themes';
import { afterEach, describe, expect, it } from 'vitest';
import { createDocumentEngine, createTypstRenderer, pdfPageCount, probeBase, resolveAssetDirs, resolveBases } from '../src';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kompass-formular-'));
  dirs.push(d);
  return d;
};

const bases = resolveBases(resolveAssetDirs({}));
const renderer = createTypstRenderer();
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));

const payload = (over: Record<string, unknown> = {}, slots: Record<string, unknown> = {}) => ({
  brand: { primary: '#2F5D68', primarySoft: '#E3EEF0', accent: '#9C5637', ink: '#191C1F', muted: '#666D75', line: '#E4E4E0', fontBody: 'Source Sans 3', fontHeading: 'Source Serif 4', fontMono: 'IBM Plex Mono' },
  organization: { 'organization.name': 'Musterverein e.V.', 'organization.street': 'Musterweg 1', 'organization.postalCode': '12345', 'organization.city': 'Musterstadt' },
  number: 'ZWB-2026-001',
  issuedDate: '05.09.2026',
  slots: { kind: 'form', title: 'Bestätigung', ...slots },
  ...over,
});

const render = (p = payload(), body = 'Körper des Formulars.', images?: Record<string, { bytes: Uint8Array; checksum: string }>, set = bases) =>
  renderer.renderDocument({ baseId: 'a4-formular', bases: set, bodyTypst: body, payload: p, images });

describe('a4-formular base', () => {
  it('is shipped with its label and kind', () => {
    expect(bases.get('a4-formular')).toMatchObject({ label: 'Formular mit Vereinskopf', kind: 'form' });
  });

  it('renders the form base with the probe payload', async () => {
    expect(await probeBase({ renderer, baseId: 'a4-formular', bases })).toEqual({ ok: true });
    const pdf = await render();
    expect(new TextDecoder().decode(pdf.subarray(0, 5))).toBe('%PDF-');
    expect(pdfPageCount(pdf)).toBe(1);
    // Die Fußzeile trägt die Nummer.
    expect(same(pdf, await render(payload({ number: 'ZWB-2026-002' })))).toBe(false);
  });

  it('does not draw recipient, subject or date — the body owns them', async () => {
    const plain = await render();
    const withLetterSlots = await render(payload({ issuedDate: '24.12.2031' }, { recipient: 'Erika Musterfrau\\\nWeg 2\\\n12345 Stadt', subject: 'Betreff', place: 'Anderswo' }));
    expect(same(plain, withLetterSlots)).toBe(true);
  });

  it('draws a draft watermark for previews', async () => {
    expect(same(await render(), await render(payload({}, { draft: true })))).toBe(false);
  });

  it('renders deterministically', async () => {
    expect(same(await render(), await render())).toBe(true);
  });

  it('renders a body image written into the job folder', async () => {
    const body = 'Unterschrift: #image("/images/signature.png", width: 20mm)';
    const pdf = await render(payload(), body, { signature: { bytes: PNG, checksum: 'sha' } });
    expect(new TextDecoder().decode(pdf.subarray(0, 5))).toBe('%PDF-');
    // Ohne Bild findet Typst die Datei nicht.
    await expect(render(payload(), body)).rejects.toThrow(/typst exited/);
  });

  it('refuses an image key outside [a-z0-9-] and bytes that are neither png nor jpeg', async () => {
    await expect(render(payload(), 'x', { '../evil': { bytes: PNG, checksum: 'sha' } })).rejects.toThrow(/image/);
    await expect(render(payload(), 'x', { seal: { bytes: new TextEncoder().encode('%PDF-1.4'), checksum: 'sha' } })).rejects.toThrow(/image/);
  });

  it('an overridden head from the volume replaces the base, the body still renders on one page', async () => {
    const vol = tmp();
    writeFileSync(
      path.join(vol, 'a4-formular.typ'),
      '#let base(payload, slots, body) = { set document(date: none); set page(paper: "a4", header: [Eigener Kopf]); set text(font: payload.brand.fontBody); body }\n',
    );
    const overlay = resolveBases({ ...resolveAssetDirs({}), documentTemplatesDir: vol });
    const body = 'Körper #image("/images/signature.png", width: 10mm)';
    const own = await render(payload(), body, { signature: { bytes: PNG, checksum: 'sha' } }, overlay);
    const shipped = await render(payload(), body, { signature: { bytes: PNG, checksum: 'sha' } });
    expect(pdfPageCount(own)).toBe(1);
    expect(same(own, shipped)).toBe(false);
  });

  it('the engine hands images from the core through to the renderer', async () => {
    const context: DocumentRenderContext = { number: 'ZWB-2026-001', issuedAt: '2026-09-05T08:00:00.000Z', organization: { 'organization.name': 'Musterverein e.V.' }, theme: DEFAULT_THEME, logo: null };
    const { bytes, pages } = await createDocumentEngine().render({
      baseId: 'a4-formular',
      bodyTypst: '#image("/images/signature.png", width: 20mm)',
      slots: { kind: 'form', title: 'Bestätigung' },
      context,
      images: { signature: { bytes: PNG, checksum: 'sha' } },
    });
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-');
    expect(pages).toBe(1);
  });
});
