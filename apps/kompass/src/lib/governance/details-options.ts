import { hasPermission, readLocales, type CallContext, type Deps } from '@kompass/core';
import { listFiscalYears } from '@kompass/module-finance';
import { listOrgans, remunerationDeciders, statuteRulesOn } from '@kompass/module-governance';
import { listMemberships, listMemberTypes } from '@kompass/module-members';
import { nameOrEmpty } from '@/lib/name-or-empty';
import type { DetailsOptions } from '@/app/(shell)/governance/resolution-details-fields';
import { readAllPages } from '@/lib/read-all-pages';

/**
 * Auswahlen für die Angaben der Beschlussarten — nur, was die Person lesen darf (Mitglieder mit `members.read`). `on`
 * ist der Tag, dessen Satzungsstand für den Hinweis „Vergütung ohne Satzungsgrundlage“ gilt (W-4).
 */
export async function detailsOptionsFor(deps: Deps, ctx: CallContext, { on, fiscalYears }: { on: string; fiscalYears?: { id: string; designation: string }[] }): Promise<DetailsOptions> {
  const organs = await listOrgans(deps, ctx, {});
  const statute = await statuteRulesOn(deps, ctx, { on });
  let years: { id: string; designation: string }[] = fiscalYears ?? [];
  if (!fiscalYears) {
    const r = await listFiscalYears(deps, ctx);
    years = r.ok ? r.value.map((y) => ({ id: y.id, designation: String(y.designation ?? '') })) : [];
  }
  const members = hasPermission(ctx, 'members.read') ? await readAllPages((page) => listMemberships(deps, ctx, { status: ['active', 'ending'], ...page }), (v) => v.items) : null;
  const types = hasPermission(ctx, 'members.read') ? await listMemberTypes(deps, ctx, {}) : null;
  const leading = readLocales(deps)[0] ?? 'de';
  return {
    organs: organs.ok ? organs.value.map((o) => ({ id: o.id, name: o.name })) : [],
    offices: organs.ok ? organs.value.flatMap((o) => o.offices.map((x) => ({ id: x.id, name: x.name, organId: o.id }))) : [],
    fiscalYears: years,
    members: members && members.ok ? members.value.map((m) => ({ id: m.id, name: m.contactName })) : null,
    memberTypes: types && types.ok ? types.value.map((ty) => ({ id: ty.id, name: nameOrEmpty(ty.name[leading], ty.key) })) : null,
    canPickDocuments: hasPermission(ctx, 'dms.view'),
    remunerationDeciders: organs.ok && statute.ok ? remunerationDeciders(statute.value.rules, organs.value.map((o) => o.id)) : {},
  };
}
