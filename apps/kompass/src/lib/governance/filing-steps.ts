import type { FilingView, RequirementRow } from '@kompass/module-governance';

export const FILING_STEP_KEYS = ['compile', 'notary', 'submitted', 'registered'] as const;
export type FilingStepKey = (typeof FILING_STEP_KEYS)[number];

/**
 * Schritte der Registeranmeldung (Board 8b): Zusammenstellen erledigt mit der Beglaubigung oder allen Pflichtunterlagen,
 * beim Notar mit der Beglaubigung, eingereicht mit dem Einreichungstag und ohne offene Zwischenverfügung, eingetragen
 * mit dem Tag der Eintragung. Aktiv ist der erste offene — nie mehr als einer.
 */
export function filingSteps(f: Pick<FilingView, 'notarizedOn' | 'submittedOn' | 'registeredOn' | 'interimOrders'>, req: Pick<RequirementRow, 'level' | 'met'>[]) {
  const required = req.filter((r) => r.level === 'required');
  const met = required.filter((r) => r.met).length;
  const openOrder = f.interimOrders.some((o) => o.resolvedOn === null);
  const registered = f.registeredOn !== null;
  const done: Record<FilingStepKey, boolean> = {
    compile: registered || f.notarizedOn !== null || met === required.length,
    notary: registered || f.notarizedOn !== null,
    submitted: registered || (f.submittedOn !== null && !openOrder),
    registered,
  };
  const active = FILING_STEP_KEYS.find((k) => !done[k]) ?? null;
  return { active, done, detail: { compile: { met, required: required.length } } };
}
