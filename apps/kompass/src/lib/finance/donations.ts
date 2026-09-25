import type { ConfirmationCheck, ConfirmationCheckResult } from '@kompass/module-finance';
import { groupOpenFirst, type RequirementGroup } from '@/lib/requirement-groups';

/**
 * Zuwendungsbestätigungen in der Oberfläche (F6a Task 7). Nur Lesen aus dem
 * Ergebnis der Prüfliste — die Fachlogik steht in `checkConfirmable`.
 */
export const DONATION_TABS = ['issued', 'uncertified', 'toCorrect', 'needsSignature'] as const;
export type DonationTab = (typeof DONATION_TABS)[number];

export function donationTab(value: string | undefined): DonationTab {
  return (DONATION_TABS as readonly string[]).includes(value ?? '') ? (value as DonationTab) : 'issued';
}

/** Die Prüfungen, die auf diese Zuwendung zutreffen — Sachspende und Aufwandsspende nur bei ihrer Art. */
export function visibleChecks(result: ConfirmationCheckResult): ConfirmationCheck[] {
  return result.checks.filter((c) => c.applies);
}

/** „maschinell erstellt“ oder „mit Unterschriftsfeld“ — aus der Prüfliste, nicht wählbar. */
export function signatureMode(result: ConfirmationCheckResult): 'machine' | 'signatureField' {
  const signer = result.checks.find((c) => c.key === 'signerValid');
  return signer && signer.applies && signer.warning === null ? 'machine' : 'signatureField';
}

/** Ausstellen geht, wenn nichts sperrt — eine Zuwendung vor Beginn der Steuerbefreiung sperrt, keine Begründung heilt das. */
export function issueAllowed(result: ConfirmationCheckResult | null): boolean {
  return !!result && result.ok;
}

/**
 * Die Prüfliste in vier Gruppen (N3, C1-2/C1-3): „Fehlt noch“ (sperrt),
 * „Bitte ansehen“ (Warnung), „Erfüllt“, „Trifft nicht zu“ (`applies: false`,
 * statt ausgeblendet). Dieselbe Regel wie `RequirementList grouping="open-first"`.
 */
export function groupChecks(checks: readonly ConfirmationCheck[]): { group: RequirementGroup; checks: ConfirmationCheck[] }[] {
  return groupOpenFirst(checks).map(({ group, items }) => ({ group, checks: items }));
}
