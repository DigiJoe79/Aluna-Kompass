import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { mediaAssets } from '../db/schema';
import type { Deps } from '../deps';

/**
 * Die Bilder der Entwicklungsdaten (Spec 2026-10-06 § 4): Joes eigene,
 * freigegebene KI-Bilder (Entscheidung 2026-10-06), keine Fotos echter Tiere,
 * keine Bilder aus dem Netz. Sie liegen als JPEG neben diesem Quelltext; im
 * gebündelten Image zeigt `import.meta.url` nicht dorthin, dann setzt das
 * Dockerfile `KOMPASS_SEED_ASSETS_DIR` (wie `KOMPASS_MIGRATIONS_DIR`).
 */
const ASSETS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets');

export function resolveSeedAssetsDir(env: Record<string, string | undefined> = process.env): string {
  return env.KOMPASS_SEED_ASSETS_DIR ?? ASSETS_DIR;
}

export const SEED_PHOTO_FOLDER = { animals: 'Fotos/Tiere', projects: 'Fotos/Projekte', website: 'Fotos/Webseite' } as const;

/** Eltern vor Kindern — so legt `createMediaFolder` sie an. */
export const SEED_PHOTO_FOLDERS = ['Fotos', SEED_PHOTO_FOLDER.animals, SEED_PHOTO_FOLDER.projects, SEED_PHOTO_FOLDER.website] as const;

export interface SeedPhoto {
  file: string;
  folder: string;
  /** Seitenverhältnis Breite / Höhe, wie mit Joe vereinbart. */
  ratio: number;
}

const animal = (file: string): SeedPhoto => ({ file, folder: SEED_PHOTO_FOLDER.animals, ratio: 4 / 5 });

export const SEED_PHOTOS: readonly SeedPhoto[] = [
  animal('baxter-1.jpg'),
  animal('baxter-2.jpg'),
  animal('frida-1.jpg'),
  animal('nala-vorher.jpg'),
  animal('nala-nachher.jpg'),
  animal('juno-1.jpg'),
  animal('pelle-1.jpg'),
  animal('pelle-2.jpg'),
  animal('pelle-3.jpg'),
  animal('mika-1.jpg'),
  animal('mika-2.jpg'),
  animal('mika-3.jpg'),
  { file: 'winterhilfe.jpg', folder: SEED_PHOTO_FOLDER.projects, ratio: 16 / 9 },
  { file: 'kastrationsaktion.jpg', folder: SEED_PHOTO_FOLDER.projects, ratio: 16 / 9 },
  { file: 'auslauf-am-heim.jpg', folder: SEED_PHOTO_FOLDER.projects, ratio: 16 / 9 },
  { file: 'startseite.jpg', folder: SEED_PHOTO_FOLDER.website, ratio: 16 / 9 },
  { file: 'aktuelles-1.jpg', folder: SEED_PHOTO_FOLDER.website, ratio: 16 / 10 },
  { file: 'team-1.jpg', folder: SEED_PHOTO_FOLDER.website, ratio: 1 },
  { file: 'team-2.jpg', folder: SEED_PHOTO_FOLDER.website, ratio: 1 },
];

/** Die Bilder aus `SEED_PHOTOS`, die in `folder` liegen und mit `prefix` beginnen — nach Namen sortiert, leer ohne Kern-Seed. */
export function seedPhotoIds(deps: Pick<Deps, 'db'>, folder: string, prefix: string): string[] {
  return deps.db
    .select({ id: mediaAssets.id, filename: mediaAssets.filename })
    .from(mediaAssets)
    .where(eq(mediaAssets.folder, folder))
    .all()
    .filter((a) => a.filename.startsWith(prefix))
    .sort((a, b) => (a.filename < b.filename ? -1 : 1))
    .map((a) => a.id);
}
