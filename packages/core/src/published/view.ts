import type { z } from 'zod';
import type { Deps } from '../deps';
import type { LabelText, PendingReviewItem, PublishedView } from '../modules/manifest';
import { resolveLabel } from '../modules/record-hooks';

/**
 * Eine veröffentlichte Sicht liefert ausschließlich Felder ihres öffentlichen Schemas.
 * Der Loader darf intern mehr laden; alles Undeklarierte wird beim Parsen entfernt.
 */
export function definePublishedView<Shape extends z.ZodRawShape>(def: {
  name: string;
  schema: z.ZodObject<Shape>;
  load: (deps: Deps) => unknown[];
  pendingReview?: (deps: Deps) => PendingReviewItem[];
  /** `title` darf ein Schlüssel der Sprachdatei sein (K2); aufgelöst wird hier, die Sicht liefert Text. */
  editLink?: (deps: Deps, row: z.infer<z.ZodObject<Shape>>) => { href: string; title: LabelText } | null;
}): PublishedView<z.infer<z.ZodObject<Shape>>> {
  return {
    name: def.name,
    schema: def.schema,
    load: (deps) => def.load(deps).map((row) => def.schema.parse(row)),
    ...(def.pendingReview ? { pendingReview: def.pendingReview } : {}),
    ...(def.editLink
      ? {
          editLink: (deps: Deps, row: z.infer<z.ZodObject<Shape>>) => {
            const link = def.editLink!(deps, row);
            return link ? { href: link.href, title: resolveLabel(deps, link.title) } : null;
          },
        }
      : {}),
  };
}
