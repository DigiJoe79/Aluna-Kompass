/**
 * Die Gruppierung „offen zuerst“ einer Prüf- oder Checkliste (N3, C1-2/C1-3;
 * HANDOFF § 13.2 `RequirementList grouping="open-first"`): „Fehlt noch“ ·
 * „Bitte ansehen“ · „Erfüllt“ · „Trifft nicht zu“. Kein Fachwort — der Baustein
 * und die Prüfliste der Bestätigungen (`groupChecks`) teilen dieselbe Regel.
 *
 * - Trifft nicht zu: `applies === false` — nichts sonst.
 * - Fehlt noch: nicht erledigt, außer die Zeile trägt nur eine Warnung, die nicht sperrt.
 * - Bitte ansehen: jede Zeile mit Warnung; sperrt sie außerdem, steht sie in beiden Gruppen —
 *   die Warnung ist ein eigener Satz, keine Wiederholung der Abhilfe.
 * - Erfüllt: erledigt und ohne Warnung.
 *
 * Leere Gruppen fehlen; innerhalb einer Gruppe bleibt die Reihenfolge der Eingabe.
 */
export const REQUIREMENT_GROUPS = ['missing', 'review', 'done', 'notApplicable'] as const;
export type RequirementGroup = (typeof REQUIREMENT_GROUPS)[number];

export interface GroupableRequirement {
  applies?: boolean;
  done: boolean;
  blocked: boolean;
  warning?: unknown;
}

export function requirementGroupsOf(item: GroupableRequirement): RequirementGroup[] {
  if (item.applies === false) return ['notApplicable'];
  const warned = item.warning !== null && item.warning !== undefined;
  const groups: RequirementGroup[] = [];
  if (!item.done && (item.blocked || !warned)) groups.push('missing');
  if (warned) groups.push('review');
  if (item.done && !warned) groups.push('done');
  return groups;
}

export function groupOpenFirst<T extends GroupableRequirement>(items: readonly T[]): { group: RequirementGroup; items: T[] }[] {
  return REQUIREMENT_GROUPS.map((group) => ({ group, items: items.filter((item) => requirementGroupsOf(item).includes(group)) })).filter((g) => g.items.length > 0);
}
