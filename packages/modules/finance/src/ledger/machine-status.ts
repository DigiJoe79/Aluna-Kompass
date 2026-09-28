/**
 * Ob das maschinelle Verfahren (R 10b.1 Abs. 4 EStR) an einem Stichtag
 * vollständig ist — rein, ohne Import, damit die Einrichtung (`setup.ts`) und
 * die Spenden (`donations/machine.ts`) dieselbe Antwort geben: `ledger/`
 * kennt `donations/` nicht (Spec 4.1).
 *
 * Vollständig = ein Unterzeichner, dessen Zeitraum den Tag einschließt
 * (taggenau, `validTo` einschließlich, offen nach hinten), **und** ein
 * Faksimile **und** der Tag der Anzeige beim Finanzamt. Ohne Unterzeichner
 * fehlt nur er — das Übrige hängt an ihm.
 */
export type MachineProcedureMissing = 'signer' | 'facsimile' | 'notifiedOn';

export interface SignerPeriod {
  validFrom: string;
  validTo: string | null;
  facsimileKey: string | null;
  notifiedOn: string | null;
}

/** Der Unterzeichner, dessen Zeitraum den Tag einschließt — Zeiträume überschneiden sich nie (`signerOverlaps`). */
export function signerAt<T extends SignerPeriod>(signers: readonly T[], date: string): T | null {
  return signers.find((s) => s.validFrom <= date && (s.validTo === null || date <= s.validTo)) ?? null;
}

export function machineStatusOf<T extends SignerPeriod>(signers: readonly T[], date: string): { signer: T | null; missing: MachineProcedureMissing[] } {
  const signer = signerAt(signers, date);
  if (!signer) return { signer: null, missing: ['signer'] };
  const missing: MachineProcedureMissing[] = [];
  if (signer.facsimileKey === null) missing.push('facsimile');
  if (signer.notifiedOn === null) missing.push('notifiedOn');
  return { signer, missing };
}

/** Ob sich zwei Zeiträume (einschließlich beider Enden, `null` = offen) berühren. */
export function periodsOverlap(a: { validFrom: string; validTo: string | null }, b: { validFrom: string; validTo: string | null }): boolean {
  return (b.validTo === null || a.validFrom <= b.validTo) && (a.validTo === null || b.validFrom <= a.validTo);
}
