import type { ConfirmationCheck, ConfirmationCheckResult } from '@kompass/module-finance';

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

/** Ausstellen geht, wenn nichts sperrt; liegt die Zuwendung vor dem ältesten Bescheid, erst mit Begründung. */
export function issueAllowed(result: ConfirmationCheckResult | null, preNoticeReason: string): boolean {
  if (!result || !result.ok) return false;
  return !result.warnings.includes('beforeOldestNotice') || preNoticeReason.trim().length > 0;
}
