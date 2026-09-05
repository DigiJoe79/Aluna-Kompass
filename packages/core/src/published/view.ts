import type { z } from 'zod';
import type { Deps } from '../deps';
import type { PublishedView } from '../modules/manifest';

/**
 * Eine veröffentlichte Sicht liefert ausschließlich Felder ihres öffentlichen Schemas.
 * Der Loader darf intern mehr laden; alles Undeklarierte wird beim Parsen entfernt.
 */
export function definePublishedView<T extends Record<string, unknown>>(def: {
  name: string;
  schema: z.ZodObject<z.ZodRawShape>;
  load: (deps: Deps) => unknown[];
}): PublishedView<T> {
  return {
    name: def.name,
    schema: def.schema as unknown as z.ZodType<T>,
    load: (deps) => def.load(deps).map((row) => def.schema.parse(row) as T),
  };
}
