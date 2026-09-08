import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { conflict, invalid, ok, type Result } from '@kompass/core';
import { z } from 'zod';

export interface SeedAsset {
  id: string;
  filename: string;
  mimeType: string;
}

export interface SeedDocument {
  variables: Record<string, unknown>;
  collections: Record<string, Array<Record<string, unknown>>>;
  assets: SeedAsset[];
}

/** Das Verzeichnis mit der Seed-Fixette, neben `kompass.template.ts`. */
export const seedDir = (templateDir: string): string => path.join(templateDir, 'seed');

const documentSchema = z.object({
  variables: z.record(z.string(), z.unknown()).default({}),
  collections: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))).default({}),
  assets: z
    .array(z.object({ id: z.string().min(1), filename: z.string().min(1), mimeType: z.string().min(1) }))
    .default([]),
});

/**
 * Liest `<templateDir>/seed/content.json`. Die Datei hat die Form des
 * Kompass-Exports; gelesen werden `variables`, `collections` und `assets`,
 * ein mitgeführtes `views` wird ignoriert.
 */
export async function readSeed(templateDir: string): Promise<Result<SeedDocument>> {
  const file = path.join(seedDir(templateDir), 'content.json');
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return conflict('noSeed', 'Das Template bringt keine Startinhalte mit (seed/content.json fehlt)');
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return invalid([{ path: 'seed/content.json', message: 'invalidJson' }]);
  }
  const parsed = documentSchema.safeParse(json);
  if (!parsed.success) {
    return invalid(parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })));
  }
  return ok(parsed.data);
}
