import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { conflict, ok, type Result } from '@kompass/core';
import type { TemplateDefinition } from '@kompass/site-template';
import { z } from 'zod';
import type { FieldSchema, TemplateSchema } from './types';

export const TEMPLATE_FILE = 'kompass.template.ts';

export type { FieldSchema, TemplateSchema } from './types';

export interface LoadedTemplate { definition: TemplateDefinition; schema: TemplateSchema; checksum: string }



/**
 * Legt die Modulauflösung für ein Template-Verzeichnis an: einen Symlink auf die
 * node_modules, in denen `@kompass/site-template` und `astro` liegen. Gehört zum
 * Einrichten, nicht zum Lesen — `loadTemplate` verändert die Platte nicht.
 * Der Weg zur node_modules läuft über `require.resolve`, damit er im Image (ein
 * flaches `/app/node_modules`) wie im Monorepo (das Paket liegt unter
 * `packages/`) trägt.
 */
/**
 * Findet das Verzeichnis von `@kompass/site-template`.
 *
 * Ausgangspunkt ist bewusst das Arbeitsverzeichnis und nicht `import.meta.url`:
 * Turbopack ersetzt letzteres beim Bündeln durch eine Modul-ID, und
 * `createRequire` einer Zahl scheitert im Container mit „path must be of type
 * string". Im Dev-Modus fällt das nie auf, weil dort nicht gebündelt wird.
 */
export function resolveTemplatePackage(from: string = process.cwd()): string {
  const requireFrom = createRequire(path.join(path.resolve(from), 'noop.js'));
  try {
    return path.dirname(requireFrom.resolve('@kompass/site-template/package.json'));
  } catch {
    throw new Error(
      `@kompass/site-template ist von ${from} aus nicht auflösbar; ohne das Paket kann kein Template gelesen werden`,
    );
  }
}

export async function ensureModuleResolution(dir: string, from?: string): Promise<void> {
  const link = path.join(dir, 'node_modules');
  try {
    await lstat(link);
    return;
  } catch {
    // fehlt noch
  }
  const pkgDir = resolveTemplatePackage(from);
  const nodeModules = path.resolve(pkgDir, '..', '..');
  if (path.basename(nodeModules) === 'node_modules') {
    await symlink(nodeModules, link, 'dir');
    return;
  }
  // Monorepo: das Paket liegt unter packages/, nicht in einer node_modules —
  // nur es selbst scoped verlinken; seine Abhängigkeiten löst Node vom echten
  // Pfad aus auf.
  await mkdir(path.join(link, '@kompass'), { recursive: true });
  await symlink(pkgDir, path.join(link, '@kompass', 'site-template'), 'dir');
}

const asJson = (schema: unknown) => z.toJSONSchema(schema as z.ZodType<unknown>, { io: 'input' }) as FieldSchema;

/** JSON-Schema je Feld — das ist die Form, die gespeichert und verglichen wird. */
function toSchema(definition: TemplateDefinition): TemplateSchema {
  return {
    name: definition.name,
    locales: definition.locales,
    uses: definition.uses,
    variables: Object.fromEntries(Object.entries(definition.variables).map(([k, v]) => [k, asJson(v)])),
    collections: Object.fromEntries(
      Object.entries(definition.collections).map(([k, c]) => [
        k,
        { label: c.label, slug: c.slug, sortable: c.sortable, publishable: c.publishable, max: c.max, fields: Object.fromEntries(Object.entries(c.fields).map(([f, s]) => [f, asJson(s)])) },
      ]),
    ),
  };
}

const isDefinition = (v: unknown): v is TemplateDefinition =>
  typeof v === 'object' && v !== null && typeof (v as TemplateDefinition).name === 'string' && Array.isArray((v as TemplateDefinition).locales) && typeof (v as TemplateDefinition).collections === 'object';

export async function loadTemplate(dir: string): Promise<Result<LoadedTemplate>> {
  const file = path.join(dir, TEMPLATE_FILE);
  let source: string;
  try {
    source = await readFile(file, 'utf8');
  } catch {
    return conflict('templateMissing', `${TEMPLATE_FILE} fehlt in ${dir}`);
  }
  // Ohne node_modules scheitert der Import an einem Bare-Specifier, und die
  // Meldung von Node erklärt niemandem, was zu tun ist.
  try {
    await lstat(path.join(dir, 'node_modules'));
  } catch {
    return conflict('templateResolutionMissing', `${dir} hat keine Modulauflösung; sie wird beim Einrichten angelegt`);
  }
  let loaded: unknown;
  try {
    // Zeitstempel im Query-Teil: sonst liefert der Modul-Cache nach einer
    // Änderung die alte Fassung, und ein Resync sähe keine Unterschiede.
    // `webpackIgnore`: der Pfad steht erst zur Laufzeit fest — der Bundler soll
    // ihn nicht auflösen wollen.
    loaded = (await import(/* webpackIgnore: true */ `${pathToFileURL(file).href}?t=${Date.now()}`)).default;
  } catch (error) {
    return conflict('templateUnreadable', error instanceof Error ? error.message.slice(0, 500) : 'Unbekannter Fehler');
  }
  if (!isDefinition(loaded)) return conflict('templateInvalid', `${TEMPLATE_FILE} exportiert keine Template-Deklaration`);
  return ok({ definition: loaded, schema: toSchema(loaded), checksum: createHash('sha256').update(source).digest('hex') });
}
