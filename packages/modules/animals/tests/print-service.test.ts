import { coreModule, setSetting, storeMediaAsset, unwrap, type Deps } from '@kompass/core';
import { auditEntry, createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { animalsModule, createAnimal, setAnimalPhotos, setAnimalPublished, setAnimalStatus } from '../src';
import { bodyParagraphs, exportAnimalProfiles, profileFacts, profileFilename, type ProfileLabels } from '../src/print/service';
import { PROFILE_URL_KEY } from '../src/settings';

type RenderRequest = Parameters<Deps['documents']['render']>[0];

const LABELS: ProfileLabels = {
  title: 'Hundeprofile',
  sexes: { female: 'Hündin', male: 'Rüde' },
  locations: { shelter: 'im Shelter', germany: 'in Deutschland' },
  status: { reserved: 'Reserviert', adopted: 'Vermittelt' },
  emergency: 'Notfall',
  sponsorable: 'Patentier',
  more: 'Mehr über {name}:',
  continued: 'Die ganze Geschichte lesen Sie online.',
};
const ALL = ['animals.view', 'animals.manage', 'documents.export', 'media.upload', 'settings.manage'];

async function setup() {
  const deps = createTestDeps({ manifests: [coreModule, animalsModule], now: '2026-10-05T10:00:00.000Z' });
  const ctx = ctxWith(ALL, insertUser(deps, {}));
  const calls: RenderRequest[] = [];
  const original = deps.documents.render;
  deps.documents.render = async (request) => {
    calls.push(request);
    return original(request);
  };
  return { deps, ctx, calls };
}

async function dog(deps: Deps, ctx: ReturnType<typeof ctxWith>, over: Record<string, unknown> = {}) {
  return unwrap(await createAnimal(deps, ctx, { name: 'Bello', sex: 'male', birthText: { de: '2020' }, sizeText: {}, sizeCm: 50, summary: { de: 'Kurz.' }, body: { de: 'Erster.\n\nZweiter *Absatz*.' }, ...over }));
}

/** Je Aufruf eine andere Farbe: Die Mediathek legt gleiche Inhalte nur einmal ab (Dedup nach Hash). */
async function jpegAsset(deps: Deps, ctx: ReturnType<typeof ctxWith>, name: string, shade: number) {
  const bytes = new Uint8Array(await sharp({ create: { width: 900, height: 1200, channels: 3, background: { r: shade, g: 128, b: 128 } } }).jpeg().toBuffer());
  return unwrap(await storeMediaAsset(deps, ctx, { originalName: name, bytes }));
}

describe('exportAnimalProfiles', () => {
  it('renders one PDF for several animals in the given order and names it after the title and the day', async () => {
    const { deps, ctx, calls } = await setup();
    const a = await dog(deps, ctx, { name: 'Anton' });
    const b = await dog(deps, ctx, { name: 'Berta', sex: 'female' });
    const result = unwrap(await exportAnimalProfiles(deps, ctx, { ids: [b.id, a.id], labels: LABELS }));
    expect(result).toMatchObject({ filename: 'Hundeprofile 2026-10-05.pdf', mimeType: 'application/pdf' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.baseId).toBe('a4-plain-slim');
    const body = calls[0]!.bodyTypst;
    expect(body.indexOf('name: "Berta"')).toBeLessThan(body.indexOf('name: "Anton"'));
  });

  it('names a single export after the animal and logs the pull without a name', async () => {
    const { deps, ctx } = await setup();
    const a = await dog(deps, ctx, { name: 'Anton' });
    expect(unwrap(await exportAnimalProfiles(deps, ctx, { ids: [a.id], labels: LABELS })).filename).toBe('Anton.pdf');
    const entry = auditEntry(deps, 'documents.export');
    expect(JSON.stringify(entry)).not.toContain('Anton');
  });

  it('takes the primary photo as print variant and up to three more as thumbs', async () => {
    const { deps, ctx, calls } = await setup();
    const a = await dog(deps, ctx);
    const assets = [];
    for (let i = 0; i < 5; i++) assets.push(await jpegAsset(deps, ctx, `foto-${i}.jpg`, 40 * i));
    unwrap(await setAnimalPhotos(deps, ctx, { id: a.id, photos: assets.map((m, i) => ({ assetId: m.id, isPrimary: i === 2 })) }));
    unwrap(await exportAnimalProfiles(deps, ctx, { ids: [a.id], labels: LABELS }));
    expect(Object.keys(calls[0]!.images ?? {}).sort()).toEqual(['p0-photo', 'p0-thumb-0', 'p0-thumb-1', 'p0-thumb-2']);
    expect(await deps.media.exists(assets[2]!.filename.replace(/\.jpg$/, '.print.jpg'))).toBe(true);
    expect(await deps.media.exists(assets[0]!.filename.replace(/\.jpg$/, '.print-thumb.jpg'))).toBe(true);
  });

  it('renders a page without photo when the primary photo is an SVG or gone (Review Focus 3)', async () => {
    const { deps, ctx, calls } = await setup();
    const a = await dog(deps, ctx);
    const svg = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'logo.svg', bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>') }));
    unwrap(await setAnimalPhotos(deps, ctx, { id: a.id, photos: [{ assetId: svg.id, isPrimary: true }] }));
    unwrap(await exportAnimalProfiles(deps, ctx, { ids: [a.id], labels: LABELS }));
    expect(calls[0]!.bodyTypst).toContain('photo: none');
  });

  it('adds the QR code only with an address template and a published animal', async () => {
    const { deps, ctx, calls } = await setup();
    const pub = await dog(deps, ctx, { name: 'Anton' });
    unwrap(await setAnimalPublished(deps, ctx, { id: pub.id, isPublished: true }));
    const draft = await dog(deps, ctx, { name: 'Berta' });
    unwrap(await exportAnimalProfiles(deps, ctx, { ids: [pub.id], labels: LABELS }));
    expect(calls[0]!.bodyTypst).toContain('qr: none');
    unwrap(await setSetting(deps, ctx, { key: PROFILE_URL_KEY, value: 'https://example.org/tiere/{slug}/' }));
    unwrap(await exportAnimalProfiles(deps, ctx, { ids: [pub.id, draft.id], labels: LABELS }));
    const body = calls[1]!.bodyTypst;
    expect(body).toContain(`url: "https://example.org/tiere/${pub.slug}/"`);
    expect(body).toContain('more: "Mehr über Anton:"');
    expect(body.match(/qr: none/g)).toHaveLength(1);
  });

  it('refuses without animals.view or documents.export, before any photo is touched', async () => {
    const { deps, ctx, calls } = await setup();
    const a = await dog(deps, ctx);
    expect(await exportAnimalProfiles(deps, ctxWith(['documents.export']), { ids: [a.id], labels: LABELS })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await exportAnimalProfiles(deps, ctxWith(['animals.view']), { ids: [a.id], labels: LABELS })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(calls).toHaveLength(0);
  });

  it('validates the ids: not empty, at most 200, no duplicates; unknown ids are notFound', async () => {
    const { deps, ctx } = await setup();
    const a = await dog(deps, ctx);
    expect(await exportAnimalProfiles(deps, ctx, { ids: [], labels: LABELS })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(await exportAnimalProfiles(deps, ctx, { ids: Array.from({ length: 201 }, (_, i) => `ID${i}`), labels: LABELS })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(await exportAnimalProfiles(deps, ctx, { ids: [a.id, a.id], labels: LABELS })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(await exportAnimalProfiles(deps, ctx, { ids: ['GIBTESNICHT'], labels: LABELS })).toMatchObject({ ok: false, error: { type: 'notFound' } });
  });
});

describe('profileFacts (Review Focus 5)', () => {
  it('lists sex, birth, size, place, emergency, status and sponsoring, without empty ones', async () => {
    const { deps, ctx } = await setup();
    const a = await dog(deps, ctx, { sex: 'female', birthText: { de: 'ca. 2017' }, sizeText: { de: 'ca. 58 cm' }, location: 'shelter', place: 'Spanien', isEmergency: true, isSponsorable: true });
    unwrap(await setAnimalStatus(deps, ctx, { id: a.id, status: 'reserved' }));
    const { loadAnimal } = await import('../src/service');
    expect(profileFacts(loadAnimal(deps.db, a.id)!, 'de', LABELS)).toEqual(['Hündin', 'ca. 2017', 'ca. 58 cm', 'im Shelter (Spanien)', 'Notfall', 'Reserviert', 'Patentier']);
    const bare = await dog(deps, ctx, { birthText: {}, sizeCm: 0, place: '' });
    expect(profileFacts(loadAnimal(deps.db, bare.id)!, 'de', LABELS)).toEqual(['Rüde', 'im Shelter']);
  });

  it('falls back to the size in cm and ignores other locales', async () => {
    const { deps, ctx } = await setup();
    unwrap(await setSetting(deps, ctx, { key: 'i18n.locales', value: ['de', 'en'] }));
    const a = await dog(deps, ctx, { birthText: { en: '2020' }, sizeText: { en: 'approx. 50 cm' }, sizeCm: 50, location: 'germany', place: '' });
    const { loadAnimal } = await import('../src/service');
    expect(profileFacts(loadAnimal(deps.db, a.id)!, 'de', LABELS)).toEqual(['Rüde', '50 cm', 'in Deutschland']);
  });
});

describe('bodyParagraphs and profileFilename', () => {
  it('splits at blank lines and converts each paragraph, escaping markup (Review Focus 4)', async () => {
    expect(await bodyParagraphs('Eins *betont*.\n\n\n  Zwei [x] #y $z  \n\n')).toEqual(['Eins _betont_.', 'Zwei \\[x\\] \\#y \\$z']);
    expect(await bodyParagraphs('')).toEqual([]);
  });

  it('keeps letters, digits, spaces, dashes; falls back to profile', () => {
    expect(profileFilename(['Bello "#1"/'], 'Hundeprofile', '2026-10-05')).toBe('Bello 1.pdf');
    expect(profileFilename(['A', 'B'], 'Hundeprofile', '2026-10-05')).toBe('Hundeprofile 2026-10-05.pdf');
    expect(profileFilename(['///'], 'Hundeprofile', '2026-10-05')).toBe('profile.pdf');
  });
});
