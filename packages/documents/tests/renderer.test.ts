import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createTypstRenderer, resolveAssetDirs, resolveBases } from '../src';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const bases = resolveBases(resolveAssetDirs({}));

const payload = (fontBody = 'Source Sans 3') => ({
  brand: { primary: '#2F5D68', primarySoft: '#E3EEF0', accent: '#9C5637', ink: '#191C1F', muted: '#666D75', line: '#E4E4E0', fontBody, fontHeading: 'Source Serif 4', fontMono: 'IBM Plex Mono' },
  organization: { 'organization.name': 'Musterverein e.V.', 'organization.city': 'Musterstadt' },
  number: 'BRF-2026-001',
  issuedDate: '05.09.2026',
  slots: { kind: 'plain', title: 'Brief' },
});

describe('typst renderer', () => {
  it('finds a typst binary of the pinned minor version', async () => {
    expect(await createTypstRenderer().version()).toMatch(/^typst 0\.15\./);
  });

  it('renders a document deterministically', async () => {
    const r = createTypstRenderer();
    const a = await r.renderDocument({ baseId: 'a4-plain', bases, bodyTypst: 'Erster Absatz.\n\nZweiter.', payload: payload() });
    const b = await r.renderDocument({ baseId: 'a4-plain', bases, bodyTypst: 'Erster Absatz.\n\nZweiter.', payload: payload() });
    expect(new TextDecoder().decode(a.subarray(0, 5))).toBe('%PDF-');
    expect(a.byteLength).toBeGreaterThan(2000);
    expect(sha(a)).toBe(sha(b));
  });

  it('treats escaped body content literally', async () => {
    const bytes = await createTypstRenderer().renderDocument({
      baseId: 'a4-plain',
      bases,
      bodyTypst: 'Preis \\#panic("x") \\[box\\] \\$x^2\\$',
      payload: payload(),
    });
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('fails loudly on an unknown base', async () => {
    await expect(
      createTypstRenderer().renderDocument({ baseId: 'gibtsnicht', bases, bodyTypst: 'x', payload: payload() }),
    ).rejects.toThrow(/unknown document base/);
  });

  it('fails loudly when a font family is unknown', async () => {
    await expect(
      createTypstRenderer().renderDocument({ baseId: 'a4-plain', bases, bodyTypst: 'x', payload: payload('Comic Sans MS') }),
    ).rejects.toThrow(/unknown font family/);
  });

  it('honours KOMPASS_TEMPLATES_DIR, KOMPASS_FONTS_DIR and KOMPASS_DOCUMENT_TEMPLATES_DIR', async () => {
    const { resolveAssetDirs } = await import('../src/renderer');
    expect(resolveAssetDirs({ KOMPASS_TEMPLATES_DIR: '/srv/t', KOMPASS_FONTS_DIR: '/srv/f' })).toEqual({
      templatesDir: '/srv/t',
      fontsDir: '/srv/f',
      documentTemplatesDir: null,
    });
    expect(resolveAssetDirs({ KOMPASS_DOCUMENT_TEMPLATES_DIR: '/srv/d' }).documentTemplatesDir).toBe('/srv/d');
  });
});
