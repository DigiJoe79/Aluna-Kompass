import { readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { CallContext } from '../context';
import type { Deps } from '../deps';
import { createMediaFolder, folderExists } from '../media/folders';
import { storeMediaInternal } from '../media/service';
import { unwrap } from '../result';
import { resolveSeedAssetsDir, SEED_PHOTO_FOLDERS, SEED_PHOTOS } from './photos';

/**
 * Beispieldateien für die Mediathek: Ordner in bis zu drei Ebenen, Bilder in
 * verschiedenen Maßen, ein PDF, ein SVG — nichts davon wird von einem Modul
 * verwendet, damit „nicht verwendet“, Löschen und Verschieben ausprobierbar
 * sind. Bilder entstehen mit sharp, damit kein Binärmaterial im Repo liegt.
 */
const IMAGES: { name: string; width: number; height: number; color: string; folder: string | null }[] = [
  { name: 'Sommerfest Wiese.jpg', width: 1600, height: 900, color: '#5b8c5a', folder: 'Bilder/2026/Sommerfest' },
  { name: 'Hoftor.png', width: 900, height: 1600, color: '#8c6a5b', folder: 'Bilder/2026' },
  { name: 'Vereinsbanner.png', width: 1200, height: 1200, color: '#5b6f8c', folder: 'Bilder' },
  { name: 'Notiz.png', width: 240, height: 160, color: '#8c8a5b', folder: null },
];

const PDF = new TextEncoder().encode(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\nxref\n0 4\n0000000000 65535 f \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n0\n%%EOF',
);

const SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><circle cx="32" cy="32" r="28" fill="none" stroke="#5b6f8c" stroke-width="4"/><path d="M20 34l8 8 16-18" fill="none" stroke="#5b6f8c" stroke-width="4"/></svg>',
);

export async function seedMedia(deps: Deps, ctx: CallContext): Promise<void> {
  if (!folderExists(deps, 'Bilder')) await seedLibraryExamples(deps, ctx);
  // Eigene Wache: Eine Entwicklungsdatenbank aus 0.2.6 hat „Bilder“ schon, aber noch keine „Fotos“.
  if (!folderExists(deps, 'Fotos')) await seedPhotos(deps, ctx);
}

async function seedLibraryExamples(deps: Deps, ctx: CallContext): Promise<void> {
  for (const folder of ['Bilder', 'Bilder/2026', 'Bilder/2026/Sommerfest', 'Dokumente']) unwrap(await createMediaFolder(deps, ctx, { path: folder }));

  for (const image of IMAGES) {
    const ext = image.name.toLowerCase().endsWith('.jpg') ? 'jpeg' : 'png';
    const base = sharp({ create: { width: image.width, height: image.height, channels: 3, background: image.color } });
    const bytes = new Uint8Array(await (ext === 'jpeg' ? base.jpeg({ quality: 85 }) : base.png()).toBuffer());
    unwrap(await storeMediaInternal(deps, ctx, { originalName: image.name, bytes, folder: image.folder }));
  }
  unwrap(await storeMediaInternal(deps, ctx, { originalName: 'Satzung Entwurf.pdf', bytes: PDF, declaredMimeType: 'application/pdf', folder: 'Dokumente' }));
  unwrap(await storeMediaInternal(deps, ctx, { originalName: 'Haken.svg', bytes: SVG, declaredMimeType: 'image/svg+xml', folder: null }));
}

/**
 * Die Bilder, die Tiere, Projekte und Webseite des Seeds tragen (Spec
 * 2026-10-06 § 4) — Joes Dateien aus `assets/`, abgelegt über den normalen
 * Weg der Mediathek (Vorschaubilder, Prüfsumme), in eigenen Ordnern unter
 * „Fotos“, damit die Beispiele unter „Bilder“ unbenutzt bleiben
 * (`media.spec.ts` prüft „nicht verwendet“). Fehlt eine Datei, bricht der Seed
 * ab: ein halber Satz Bilder ist kein Zustand, den die Bilder der Pipeline zeigen sollen.
 */
async function seedPhotos(deps: Deps, ctx: CallContext): Promise<void> {
  const dir = resolveSeedAssetsDir();
  for (const folder of SEED_PHOTO_FOLDERS) unwrap(await createMediaFolder(deps, ctx, { path: folder }));
  for (const photo of SEED_PHOTOS) {
    const bytes = new Uint8Array(readFileSync(path.join(dir, photo.file)));
    unwrap(await storeMediaInternal(deps, ctx, { originalName: photo.file, bytes, declaredMimeType: 'image/jpeg', folder: photo.folder }));
  }
}
