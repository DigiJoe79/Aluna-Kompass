import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { conflict, ok, type Result } from '@kompass/core';
import type { TemplateDefinition } from '@kompass/site-template';
import { z } from 'zod';

export const TEMPLATE_FILE = 'kompass.template.ts';

export interface FieldSchema { widget?: string; label?: string; [key: string]: unknown }
export interface TemplateSchema {
  name: string;
  locales: string[];
  uses: string[];
  variables: Record<string, FieldSchema>;
  collections: Record<string, { label: string; slug: boolean; sortable: boolean; publishable: boolean; max?: number; fields: Record<string, FieldSchema> }>;
}
export interface LoadedTemplate { definition: TemplateDefinition; schema: TemplateSchema; checksum: string }

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
  let loaded: unknown;
  try {
    // Zeitstempel im Query-Teil: sonst liefert der Modul-Cache nach einer
    // Änderung die alte Fassung, und ein Resync sähe keine Unterschiede.
    loaded = (await import(`${pathToFileURL(file).href}?t=${Date.now()}`)).default;
  } catch (error) {
    return conflict('templateUnreadable', error instanceof Error ? error.message.slice(0, 500) : 'Unbekannter Fehler');
  }
  if (!isDefinition(loaded)) return conflict('templateInvalid', `${TEMPLATE_FILE} exportiert keine Template-Deklaration`);
  return ok({ definition: loaded, schema: toSchema(loaded), checksum: createHash('sha256').update(source).digest('hex') });
}
