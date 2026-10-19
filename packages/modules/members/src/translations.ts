import { notFound, ok, readLocales, requirePermission, type CallContext, type Deps, type LocalizedText, type Result, type Translatable, type TranslationWrite } from '@kompass/core';
import { asc, eq } from 'drizzle-orm';
import { memberTypes } from './schema';
import { saveMemberType } from './types';

/** Die Mitgliedsarten mit ihrem mehrsprachigen Namen, auch die deaktivierten. Nicht aus `index.ts` exportieren. */
export function membersTranslatables(deps: Deps, ctx: CallContext): Result<Translatable[]> {
  const denied = requirePermission(ctx, 'members.read');
  if (denied) return denied;
  const leading = readLocales(deps)[0]!;
  const rows = deps.db.select().from(memberTypes).orderBy(asc(memberTypes.sortOrder), asc(memberTypes.key)).all();
  // Die Seite der Mitgliedsarten kommt mit der Oberfläche (U1); bis dahin führt der Weg in die Verwaltung des Moduls.
  return ok(rows.map((t) => ({ entityType: 'memberType', id: t.id, label: t.name[leading] || t.key, href: '/admin/members', fields: { name: t.name } })));
}

/** Über `saveMemberType`: eine Transaktion, ein Protokolleintrag, nur die genannten Sprachen ersetzt. */
export function membersSetTranslations(deps: Deps, ctx: CallContext, input: TranslationWrite): Promise<Result<unknown>> | null {
  if (input.entityType !== 'memberType') return null;
  return (async () => {
    const before = deps.db.select().from(memberTypes).where(eq(memberTypes.id, input.id)).get();
    if (!before) return notFound('memberType', input.id);
    let name: LocalizedText = before.name;
    for (const item of input.items) {
      if (item.field !== 'name' || typeof item.text !== 'string') return notFound('field', item.field);
      name = { ...name, [item.locale]: item.text };
    }
    return saveMemberType(deps, ctx, { id: before.id, name, hasVotingRight: before.hasVotingRight, feeExempt: before.feeExempt });
  })();
}
