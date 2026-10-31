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

/**
 * Die Zeilen einer Sammelbestätigung aus „Noch nicht bestätigt“: alle fähigen Geldzeilen. Keine Sachspende (der Dienst
 * lehnt die Mischung ab), nichts in der Zukunft, kein möglicher Rückläufer. Eine Sammelbestätigung gilt für ein
 * Kalenderjahr: Liegen die Zeilen in mehreren, dann das älteste mit mindestens zwei, das nächste folgt danach. Leer, wenn
 * es keine zwei gibt.
 */
export function collectiveLineIds<T extends { lineId: string; entryDate: string; incomeKind: string | null; inFuture?: true; warnings?: readonly string[] }>(lines: readonly T[]): string[] {
  const able = lines.filter((line) => line.incomeKind !== 'inKindDonation' && !line.inFuture && !line.warnings?.length);
  const years = [...new Set(able.map((line) => line.entryDate.slice(0, 4)))].sort();
  for (const year of years) {
    const ofYear = able.filter((line) => line.entryDate.startsWith(year));
    if (ofYear.length >= 2) return ofYear.map((line) => line.lineId);
  }
  return [];
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
