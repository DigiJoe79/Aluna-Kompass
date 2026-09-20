import { describe, expect, it } from 'vitest';
import { financeModule } from '../src/manifest';

/**
 * Platzhalter, solange Task 12 (`seedFinance`, das erfundene Vereinsjahr, der
 * Wächter gegen Namen/IBAN im Protokoll) noch aussteht — der Bestandstest
 * `apps/kompass/tests/module-seeds.test.ts` verlangt für jedes installierte
 * Modul einen `seed`-Haken und eine Datei genau hier. Task 12 ersetzt diese
 * Datei durch die echten Tests aus der Spec.
 */
describe('finance seed (placeholder until Task 12)', () => {
  it('declares a seed hook on the manifest', () => {
    expect(typeof financeModule.seed).toBe('function');
  });
});
