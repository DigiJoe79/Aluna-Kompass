import { describe, expect, it } from 'vitest';
import { createTypstRenderer, resolveAssetDirs, resolveBases } from '../src';

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
