import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createTypstRenderer, findTypstBinary } from '../src';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

describe('typst renderer', () => {
  it('finds a typst binary of the pinned minor version', async () => {
    expect(findTypstBinary()).toBeTruthy();
    expect(await createTypstRenderer().version()).toMatch(/^typst 0\.15\./);
  });

  it('renders the letterhead template deterministically', async () => {
    const renderer = createTypstRenderer();
    const payload = {
      data: { title: 'Testbrief', body: 'Erster Absatz.\n\nZweiter Absatz.', letterhead: true },
      organization: { 'organization.name': 'Musterverein e.V.', 'organization.street': 'Musterweg 1', 'organization.postalCode': '12345', 'organization.city': 'Musterstadt', 'organization.registerCourt': 'Amtsgericht Musterstadt', 'organization.registerNumber': 'VR 1234', 'organization.email': 'info@example.org' },
      number: 'BRF-2026-001',
      issuedDate: '05.09.2026',
      brand: { primary: '#2F5D68', accent: '#9C5637', ink: '#191C1F', muted: '#666D75', line: '#E4E4E0', fontBody: 'Source Sans 3', fontHeading: 'Source Serif 4', fontMono: 'IBM Plex Mono' },
      hasLogo: false,
    };
    const a = await renderer.render('letterhead.typ', payload);
    const b = await renderer.render('letterhead.typ', payload);
    expect(new TextDecoder().decode(a.subarray(0, 5))).toBe('%PDF-');
    expect(a.byteLength).toBeGreaterThan(5000);
    expect(sha(a)).toBe(sha(b));
  });

  it('treats user text as literal, not as markup or code', async () => {
    const renderer = createTypstRenderer();
    const hostile = { title: '#panic("x") ]', body: '*nicht fett* #text(red)[rot] $x^2$ // kein Kommentar', letterhead: false };
    const bytes = await renderer.render('letterhead.typ', { data: hostile, organization: {}, number: 'BRF-2026-002', issuedDate: '05.09.2026', brand: { primary: '#000000', accent: '#000000', ink: '#000000', muted: '#666666', line: '#cccccc', fontBody: 'Source Sans 3', fontHeading: 'Source Serif 4', fontMono: 'IBM Plex Mono' }, hasLogo: false });
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('honours KOMPASS_TEMPLATES_DIR and KOMPASS_FONTS_DIR', async () => {
    const { resolveAssetDirs } = await import('../src/renderer');
    const dirs = resolveAssetDirs({ KOMPASS_TEMPLATES_DIR: '/srv/t', KOMPASS_FONTS_DIR: '/srv/f' });
    expect(dirs).toEqual({ templatesDir: '/srv/t', fontsDir: '/srv/f' });
  });

  it('fails loudly when a font family is unknown', async () => {
    const renderer = createTypstRenderer();
    await expect(renderer.render('letterhead.typ', { data: { title: 'x', body: 'y', letterhead: false }, organization: {}, number: 'N', issuedDate: 'D', brand: { primary: '#000000', accent: '#000000', ink: '#000000', muted: '#666666', line: '#cccccc', fontBody: 'Comic Sans MS', fontHeading: 'Source Serif 4', fontMono: 'IBM Plex Mono' }, hasLogo: false })).rejects.toThrow(/unknown font family/);
  });
});
