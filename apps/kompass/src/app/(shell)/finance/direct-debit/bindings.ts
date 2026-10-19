import { readLocales, type CallContext, type Deps } from '@kompass/core';
import { listPurposes } from '@kompass/module-finance';
import { listProjects } from '@kompass/module-projects';
import type { LocalizedText } from '@kompass/core';

/**
 * Zweckbindung einer Zusage zum Anzeigen und Wählen (Handoff 2a § 1.5): die Zwecke der Finanzen und die Projekte, mit
 * Schlüssel `purpose:<id>` bzw. `project:<id>`. Die Namen kommen aus den Diensten beider Module.
 */
export async function pledgeBindings(deps: Deps, ctx: CallContext, { includeInactive = false } = {}): Promise<{ value: string; label: string }[]> {
  const [purposes, projects] = await Promise.all([listPurposes(deps, ctx, { includeInactive }), listProjects(deps, ctx)]);
  const leading = readLocales(deps)[0] ?? 'de';
  return [
    ...(purposes.ok ? purposes.value : []).map((p) => ({ value: `purpose:${p.id}`, label: p.name })),
    ...(projects.ok ? projects.value : []).map((p) => ({ value: `project:${p.id}`, label: (p.name as LocalizedText)[leading] || p.slug })),
  ];
}

export const bindingOf = (row: { purposeId: string | null; projectId: string | null }) => (row.purposeId ? `purpose:${row.purposeId}` : row.projectId ? `project:${row.projectId}` : null);
