import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, realpath, rm, symlink } from 'node:fs/promises';
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

/**
 * Die node_modules, die ein Template zum Bauen braucht — mit `astro` darin.
 *
 * Nicht die Wurzel des Projekts: pnpm installiert nicht flach, `astro` liegt
 * bei dem Paket, das es als Abhängigkeit führt. Das mitgelieferte Basis-Template
 * hat genau die richtige Menge, im Image wie im Monorepo.
 */
export function resolveTemplateNodeModules(): string {
  if (process.env.SITE_NODE_MODULES) return path.resolve(process.env.SITE_NODE_MODULES);
  const root = path.resolve(resolveTemplatePackage(), '..', '..');
  return path.join(root, 'templates', 'verein-basis', 'node_modules');
}

/**
 * Sorgt dafür, dass `@kompass/site-template` in einer mitgebrachten
 * node_modules ein Link auf die Fassung von Kompass ist.
 *
 * pnpm legt eine `file:`-Abhängigkeit als Kopie ab. Dann liegt das Paket als
 * TypeScript unter `node_modules`, und Node entfernt dort keine Typen
 * („Stripping types is currently unsupported for files under node_modules“).
 * Über einen Symlink löst Node den echten Pfad auf, der ausserhalb liegt.
 * Nebeneffekt und Absicht zugleich: Der Vertrag stammt damit immer aus der
 * laufenden Fassung und nicht aus einer Kopie von vor drei Updates.
 */
async function linkContractPackage(nodeModules: string, from?: string): Promise<void> {
  const target = resolveTemplatePackage(from);
  const link = path.join(nodeModules, '@kompass', 'site-template');
  try {
    if (await realpath(link) === await realpath(target)) return;
  } catch {
    // fehlt oder zeigt ins Leere — in beiden Fällen neu setzen
  }
  await mkdir(path.dirname(link), { recursive: true });
  await rm(link, { recursive: true, force: true });
  await symlink(target, link, 'dir');
}

export async function ensureModuleResolution(dir: string, from?: string): Promise<void> {
  const link = path.join(dir, 'node_modules');
  const target = () => {
    resolveTemplatePackage(from);
    return resolveTemplateNodeModules();
  };
  let existing: Awaited<ReturnType<typeof lstat>> | undefined;
  try {
    existing = await lstat(link);
  } catch {
    // fehlt noch
  }
  if (existing && !existing.isSymbolicLink()) return linkContractPackage(link, from); // eigene Installation: nur der Vertrag gehört uns
  if (existing) {
    // Ein Symlink aus einer früheren Fassung kann auf die falsche node_modules
    // zeigen. Das fällt erst beim Build auf („astro not installed“), und niemand
    // kommt darauf, ihn von Hand zu löschen — also hier richten.
    const wanted = target();
    if (existsSync(path.join(link, 'astro'))) return;
    await rm(link);
    await symlink(wanted, link, 'dir');
    return;
  }
  await symlink(target(), link, 'dir');
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
