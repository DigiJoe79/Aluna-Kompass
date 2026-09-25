/** Bilder im Körper eines Dokuments — rein, ohne Abhängigkeiten, damit Renderer und Vorlagen sie teilen. */

/** Schlüssel eines Bildes in `DocumentBuildResult.images`; zugleich sein Dateiname im Job. */
export const DOCUMENT_IMAGE_KEY = /^[a-z0-9-]+$/;

/** Dateiendung eines Bildes aus seinen ersten Bytes: PNG oder JPEG, sonst `null`. */
export function documentImageExtension(bytes: Uint8Array): 'png' | 'jpg' | null {
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  return null;
}

/** Der Pfad, unter dem der Körper ein Bild aus `images` einbindet: `/images/<key>.<ext>`. */
export function documentImagePath(key: string, bytes: Uint8Array): string {
  const ext = documentImageExtension(bytes);
  return ext ? `/images/${key}.${ext}` : `/images/${key}`;
}
