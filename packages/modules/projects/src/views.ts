import { definePublishedView, localizedText, type Deps } from '@kompass/core';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { projects } from './schema';

/**
 * Projekte in ihrer öffentlichen Form. Die Verweise nach aussen kommen mit;
 * ob daraus ein Spendenformular oder eine Schaltfläche wird, weiss das
 * Template. Finanzfelder kommen hier nie dazu: Was ein Spendenzweck intern
 * kostet und einbringt, ist Rechenschaft, keine Webseite.
 */
export const publishedProjects = definePublishedView({
  name: 'projects',
  schema: z.object({
    slug: z.string(),
    name: localizedText(),
    type: z.enum(['ongoing', 'shortTerm']),
    status: z.enum(['active', 'completed']),
    summary: localizedText(),
    body: localizedText(),
    imageAssetId: z.string().nullable(),
    externalLinks: z.array(z.object({ label: z.string(), url: z.string() })),
    sortOrder: z.number(),
  }),
  load: (deps: Deps) =>
    deps.db.select().from(projects).where(eq(projects.isPublished, true)).orderBy(asc(projects.sortOrder)).all(),
});
