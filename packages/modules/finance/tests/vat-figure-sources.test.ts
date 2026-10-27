import { describe, expect, it } from 'vitest';
import { vatFiguresDiffer } from '../src/ledger/vat-figure-sources';

describe('vatFiguresDiffer', () => {
  it('compares bases in full euros and tax in cents', () => {
    expect(vatFiguresDiffer({ rc13bOtherBase: 4950 }, { rc13bOtherBase: 4999 })).toBe(false);
    expect(vatFiguresDiffer({ rc13bOtherBase: 4950 }, { rc13bOtherBase: 5000 })).toBe(true);
    expect(vatFiguresDiffer({ rc13bOtherTax: 931 }, { rc13bOtherTax: 932 })).toBe(true);
  });

  it('ignores Kz 10 and the turnover of a small business (Kz 48), which change no tax', () => {
    expect(vatFiguresDiffer({ amended: 0 }, { amended: 1 })).toBe(false);
    expect(vatFiguresDiffer({ smallBusinessTurnover: 30000 }, { smallBusinessTurnover: 45000 })).toBe(false);
  });
});
