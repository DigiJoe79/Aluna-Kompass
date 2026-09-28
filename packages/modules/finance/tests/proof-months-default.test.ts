import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import { saveProfileBaseSchema } from '../src/allocation/partners';
import { DEFAULT_PROOF_MONTHS, financePartnerProfiles } from '../src/schema';

/**
 * Teil C Task 2d: die übliche Nachweisfrist hat einen Standardwert an einer
 * Stelle — Spaltenvorgabe, Eingabeschema und Rückfall der Fristrechnung
 * (`proofDueOnOf`) lesen dieselbe Konstante.
 */
describe('DEFAULT_PROOF_MONTHS', () => {
  it('ist die Vorgabe der Spalte usual_proof_months und des Eingabeschemas', () => {
    const column = getTableConfig(financePartnerProfiles).columns.find((c) => c.name === 'usual_proof_months')!;
    expect(column.default).toBe(DEFAULT_PROOF_MONTHS);
    expect(saveProfileBaseSchema.shape.usualProofMonths.parse(undefined)).toBe(DEFAULT_PROOF_MONTHS);
  });
});
