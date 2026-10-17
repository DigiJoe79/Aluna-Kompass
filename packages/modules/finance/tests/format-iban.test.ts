import { describe, expect, it } from 'vitest';
import { compactIban, formatIban, maskIban } from '../src/format';

const NBSP = ' ';

describe('IBAN', () => {
  it('compactIban entfernt alle Leerräume und schreibt groß', () => {
    expect(compactIban(' de02 9999\u00a09999\t0532 0130 00 ')).toBe('DE02999999990532013000');
  });

  // Runde 3, 064: Umbrechen darf die Nummer nur zwischen den Gruppen. Ein geschütztes Leerzeichen machte die ganze
  // IBAN zu einem Wort, das der Browser dann mitten in einer Gruppe brach („1122 3 / 3“); in der Gruppe selbst steht
  // nie ein Umbruchpunkt.
  it('formatIban gruppiert zu vieren, umbrechbar nur zwischen den Gruppen', () => {
    expect(formatIban('de02999999990532013000')).toBe(['DE02', '9999', '9999', '0532', '0130', '00'].join(' '));
    expect(formatIban('NO93 8601 1117 947')).toBe(['NO93', '8601', '1117', '947'].join(' '));
    expect(formatIban('MT84MALT011000012345MTLCAST001S')).toBe(['MT84', 'MALT', '0110', '0001', '2345', 'MTLC', 'AST0', '01S'].join(' '));
    expect(formatIban('DE12999999990000112233')).not.toContain(NBSP);
  });

  it('maskIban zeigt Land und die letzten vier', () => {
    expect(maskIban('DE02 9999 9999 0532 0130 00')).toBe(`DE${NBSP}··${NBSP}3000`);
    expect(maskIban(' no9386011117947 ')).toBe(`NO${NBSP}··${NBSP}7947`);
    expect(maskIban('DE12')).toBe('DE12');
  });
});
