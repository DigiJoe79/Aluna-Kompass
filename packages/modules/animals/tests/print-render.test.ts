import { DEFAULT_THEME } from '@kompass/core/themes';
import type { DocumentRenderContext } from '@kompass/core';
import { createDocumentEngine, pdfPageCount } from '@kompass/documents';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { qrRows } from '../src/print/qr';
import { animalProfileTemplate, PROFILE_BASE, type ProfileImage, type ProfileInput, type ProfilePage } from '../src/print/template';

const engine = createDocumentEngine();
const ctx: DocumentRenderContext = { number: '', issuedAt: '2026-10-05T12:00:00.000Z', organization: { 'organization.name': 'Musterverein e.V.' }, theme: DEFAULT_THEME, logo: null };

async function jpeg(width: number, height: number): Promise<ProfileImage> {
  const bytes = new Uint8Array(await sharp({ create: { width, height, channels: 3, background: '#808080' } }).jpeg().toBuffer());
  return { bytes, checksum: `${width}x${height}`.padEnd(64, '0'), width, height };
}

let photo: ProfileImage;
let thumb: ProfileImage;
beforeAll(async () => {
  photo = await jpeg(1200, 1500);
  thumb = await jpeg(400, 300);
});

const LONG = 'Ein langer Absatz über das Leben auf dem Hof, die Felder ringsum und die Menschen, die Futter brachten. '.repeat(4);
const page = (over: Partial<ProfilePage> = {}): ProfilePage => ({
  name: 'Bello "#1" $\\ [x]',
  facts: ['Rüde', 'ca. 2020', 'ca. 50 cm', 'im Shelter (Rumänien)', 'Reserviert'],
  traits: ['ruhig', 'verträglich', 'leinenführig'],
  summary: 'Ein freundlicher Rüde, der gern auf dem Sofa liegt.',
  paragraphs: ['Kurzer erster Absatz mit _Betonung_.', 'Zweiter Absatz.'],
  photo,
  thumbs: [thumb, thumb, thumb],
  qr: qrRows('https://example.org/tiere/bello/'),
  url: 'https://example.org/tiere/bello/',
  more: 'Mehr über Bello:',
  continued: 'Die ganze Geschichte lesen Sie online.',
  ...over,
});

async function pages(list: ProfilePage[]): Promise<number | null> {
  const input: ProfileInput = { frame: { aspect: [4, 5], focusX: 50, focusY: 40 }, pages: list };
  const built = animalProfileTemplate.build(input, ctx);
  const { bytes } = await engine.render({ baseId: PROFILE_BASE, bodyTypst: 'typst' in built.body ? built.body.typst : '', slots: built.slots, context: ctx, images: built.images });
  return pdfPageCount(bytes);
}

describe('profile pages with real Typst', () => {
  it('keeps every animal on exactly one page, however long the text', async () => {
    const overlong = Array.from({ length: 12 }, (_, i) => `${LONG} Absatz ${i + 1}.`);
    expect(await pages([page({ paragraphs: overlong })])).toBe(1);
    expect(await pages([page(), page({ paragraphs: overlong }), page({ paragraphs: overlong, qr: null, url: '' })])).toBe(3);
  }, 60_000);

  it('handles the edge cases: no photo, one thumb, empty texts, an overlong summary', async () => {
    expect(
      await pages([
        page({ photo: null, thumbs: [] }),
        page({ thumbs: [thumb] }),
        page({ summary: '', paragraphs: [], traits: [], facts: [] }),
        page({ summary: 'Sehr lang. '.repeat(250) }),
      ]),
    ).toBe(4);
  }, 60_000);
});
