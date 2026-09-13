import sharp from 'sharp';
import type { CallContext } from '../context';
import type { Deps } from '../deps';
import { createMediaFolder, folderExists } from '../media/folders';
import { storeMediaInternal } from '../media/service';
import { unwrap } from '../result';

/**
 * Beispieldateien für die Mediathek: Ordner in zwei Ebenen, Bilder in
 * verschiedenen Maßen, ein PDF, ein SVG — nichts davon wird von einem Modul
 * verwendet, damit „nicht verwendet“, Löschen und Verschieben ausprobierbar
 * sind. Bilder entstehen mit sharp, damit kein Binärmaterial im Repo liegt.
 */
const IMAGES: { name: string; width: number; height: number; color: string; folder: string | null }[] = [
  { name: 'Sommerfest Wiese.jpg', width: 1600, height: 900, color: '#5b8c5a', folder: 'Bilder/2026' },
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
  if (folderExists(deps, 'Bilder')) return;
  for (const path of ['Bilder', 'Bilder/2026', 'Dokumente']) unwrap(await createMediaFolder(deps, ctx, { path }));

  for (const image of IMAGES) {
    const ext = image.name.toLowerCase().endsWith('.jpg') ? 'jpeg' : 'png';
    const base = sharp({ create: { width: image.width, height: image.height, channels: 3, background: image.color } });
    const bytes = new Uint8Array(await (ext === 'jpeg' ? base.jpeg({ quality: 85 }) : base.png()).toBuffer());
    unwrap(await storeMediaInternal(deps, ctx, { originalName: image.name, bytes, folder: image.folder }));
  }
  unwrap(await storeMediaInternal(deps, ctx, { originalName: 'Satzung Entwurf.pdf', bytes: PDF, declaredMimeType: 'application/pdf', folder: 'Dokumente' }));
  unwrap(await storeMediaInternal(deps, ctx, { originalName: 'Haken.svg', bytes: SVG, declaredMimeType: 'image/svg+xml', folder: null }));
}
