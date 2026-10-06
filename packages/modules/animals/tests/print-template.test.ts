import { describe, expect, it } from 'vitest';
import { animalsModule } from '../src/manifest';
import { animalProfileTemplate, PROFILE_BASE, PROFILE_TEMPLATE_KEY, profileInputSchema, type ProfileInput, type ProfilePage } from '../src/print/template';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const image = { bytes: JPEG, checksum: 'c'.repeat(64), width: 1200, height: 1500 };
const page = (over: Partial<ProfilePage> = {}): ProfilePage => ({
  name: 'Bello',
  facts: ['Rüde', '2020'],
  traits: ['ruhig'],
  summary: 'Kurz.',
  paragraphs: ['Erster Absatz.', 'Zweiter _Absatz_.'],
  photo: image,
  thumbs: [image, image],
  qr: ['0000', '0110', '0110', '0000'],
  url: 'https://example.org/tiere/bello/',
  more: 'Mehr über Bello:',
  continued: 'Weiter online.',
  ...over,
});
const input = (pages: ProfilePage[]): ProfileInput => ({ frame: { aspect: [4, 5], focusX: 50, focusY: 40 }, pages });
const ctx = { number: '', issuedAt: '2026-10-05T12:00:00.000Z', organization: {}, theme: {} as never, logo: null };

describe('animalProfileTemplate', () => {
  it('is an ad-hoc extract on the slim base, readable with animals.view, registered in the manifest', () => {
    expect(animalProfileTemplate).toMatchObject({ key: PROFILE_TEMPLATE_KEY, type: 'animal-profile', base: PROFILE_BASE, permission: 'animals.view', filed: false });
    expect(PROFILE_BASE).toBe('a4-plain-slim');
    expect(animalsModule.documentTemplates).toContain(animalProfileTemplate);
    expect(animalsModule.documentBases).toContain(PROFILE_BASE);
  });

  it('builds one page call per animal, separated by page breaks, with an empty title slot', () => {
    const built = animalProfileTemplate.build(input([page(), page({ name: 'Zwei' })]), ctx);
    const body = 'typst' in built.body ? built.body.typst : '';
    expect(body.match(/#profile-page\(/g)).toHaveLength(2);
    expect(body.match(/#pagebreak\(\)/g)).toHaveLength(1);
    // Ein Titel zeichnete auf Seite 1 einen Block über das erste Tier (Spec § 6).
    expect(built.slots.title).toBeUndefined();
  });

  it('hands every photo over as an image with a path the body uses', () => {
    const built = animalProfileTemplate.build(input([page()]), ctx);
    const body = 'typst' in built.body ? built.body.typst : '';
    expect(Object.keys(built.images ?? {}).sort()).toEqual(['p0-photo', 'p0-thumb-0', 'p0-thumb-1']);
    expect(body).toContain('path: "/images/p0-photo.jpg", w: 1200, h: 1500');
    expect(body).toContain('aspect: (4, 5), focus: (50, 40)');
  });

  it('writes free text as string literals, so nothing in it acts as markup', () => {
    const built = animalProfileTemplate.build(input([page({ name: 'Bello "#1" $\\ [x]', summary: 'a*b*' })]), ctx);
    const body = 'typst' in built.body ? built.body.typst : '';
    expect(body).toContain('name: "Bello \\"#1\\" $\\\\ [x]"');
    expect(body).toContain('summary: "a*b*"');
  });

  it('passes none for a missing photo and a missing QR code, () for no thumbs', () => {
    const built = animalProfileTemplate.build(input([page({ photo: null, thumbs: [], qr: null, url: '' })]), ctx);
    const body = 'typst' in built.body ? built.body.typst : '';
    expect(body).toContain('photo: none');
    expect(body).toContain('thumbs: ()');
    expect(body).toContain('qr: none');
    expect(built.images).toEqual({});
  });

  it('uses no colour literal but the brand and black for the QR modules', () => {
    const built = animalProfileTemplate.build(input([page()]), ctx);
    const body = 'typst' in built.body ? built.body.typst : '';
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(body.match(/rgb\(([^)]*)\)/g)?.every((call) => call.includes('profile-brand.'))).toBe(true);
  });

  it('refuses more than three thumbs and an empty page list', () => {
    expect(profileInputSchema.safeParse(input([page({ thumbs: [image, image, image, image] })])).success).toBe(false);
    expect(profileInputSchema.safeParse(input([])).success).toBe(false);
  });
});
