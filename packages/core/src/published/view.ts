import type { z } from 'zod';
import type { Deps } from '../deps';
import type { PendingReviewItem, PublishedView } from '../modules/manifest';

/**
 * Eine veröffentlichte Sicht liefert ausschließlich Felder ihres öffentlichen Schemas.
 * Der Loader darf intern mehr laden; alles Undeklarierte wird beim Parsen entfernt.
 */
export function definePublishedView<Shape extends z.ZodRawShape>(def: {
  name: string;
  schema: z.ZodObject<Shape>;
  load: (deps: Deps) => unknown[];
  pendingReview?: (deps: Deps) => PendingReviewItem[];
}): PublishedView<z.infer<z.ZodObject<Shape>>> {
  return {
    name: def.name,
    schema: def.schema,
    load: (deps) => def.load(deps).map((row) => def.schema.parse(row)),
    ...(def.pendingReview ? { pendingReview: def.pendingReview } : {}),
  };
}
