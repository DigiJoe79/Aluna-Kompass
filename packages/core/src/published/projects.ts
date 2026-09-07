import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { projects } from '../db/schema';
import type { Deps } from '../deps';
import { localizedText } from '../i18n/localized';
import { definePublishedView } from './view';

/**
 * Projekte in ihrer öffentlichen Form. Die Tabelle liegt im Kern, deshalb die
 * Sicht auch — ein Template führt sie nicht als eigene Sammlung, sonst pflegte
 * es Daten, die ihm nicht gehören.
 *
 * Ab Stufe 3 tragen Projekte Finanzfelder. Die kommen hier nicht dazu: Was ein
 * Spendenzweck intern kostet und einbringt, ist Rechenschaft, keine Webseite.
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
    betterplaceProjectId: z.string(),
    sortOrder: z.number(),
  }),
  load: (deps: Deps) =>
    deps.db.select().from(projects).where(eq(projects.isPublished, true)).orderBy(asc(projects.sortOrder)).all(),
});
