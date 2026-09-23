import { describe, expectTypeOf, it } from 'vitest';
import type { CamtLine } from '../src/import/camt';
import type { CsvLine } from '../src/import/csv';

/** Der CSV-Kern deklariert seine Zeile selbst (er lädt nichts außerhalb von `csv/`); sie muss trotzdem in `importLines` passen. */
describe('CsvLine', () => {
  it('is assignable to CamtLine', () => {
    expectTypeOf<CsvLine>().toMatchTypeOf<CamtLine>();
  });
});
