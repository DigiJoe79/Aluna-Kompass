import { notFound, ok, readLocales, requirePermission, type CallContext, type Deps, type LocalizedText, type Result, type Translatable, type TranslationWrite } from '@kompass/core';
import { asc, eq } from 'drizzle-orm';
import { projects } from './schema';
import { updateProject, type ProjectRecord } from './service';

const FIELDS = ['name', 'summary', 'body'] as const;
type Field = (typeof FIELDS)[number];
const isField = (f: string): f is Field => (FIELDS as readonly string[]).includes(f);

const labelOf = (p: ProjectRecord, leading: string): string => (p.name as LocalizedText)[leading] || p.slug;

/** Alle Projekte, auch unveröffentlichte. */
export function projectsTranslatables(deps: Deps, ctx: CallContext): Result<Translatable[]> {
  const denied = requirePermission(ctx, 'projects.view');
  if (denied) return denied;
  const leading = readLocales(deps)[0]!;
  const rows = deps.db.select().from(projects).orderBy(asc(projects.sortOrder)).all();
  return ok(
    rows.map((p) => ({
      entityType: 'project',
      id: p.id,
      label: labelOf(p, leading),
      href: `/projects/${p.id}`,
      fields: { name: p.name as LocalizedText, summary: p.summary as LocalizedText, body: p.body as LocalizedText },
    })),
  );
}

/** Ein `updateProject` je Projekt; nur die genannten Sprachschlüssel ersetzt. */
export function projectsSetTranslations(deps: Deps, ctx: CallContext, input: TranslationWrite): Promise<Result<unknown>> | null {
  if (input.entityType !== 'project') return null;
  return (async () => {
    const denied = requirePermission(ctx, 'projects.manage');
    if (denied) return denied;
    const before = deps.db.select().from(projects).where(eq(projects.id, input.id)).get();
    if (!before) return notFound('project', input.id);
    const changes: Partial<Record<Field, LocalizedText>> = {};
    for (const item of input.items) {
      if (!isField(item.field) || typeof item.text !== 'string') return notFound('field', item.field);
      const current = changes[item.field] ?? (before[item.field] as LocalizedText);
      changes[item.field] = { ...current, [item.locale]: item.text };
    }
    return updateProject(deps, ctx, { id: input.id, ...changes });
  })();
}
