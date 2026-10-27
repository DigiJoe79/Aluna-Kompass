import { describe, expect, it } from 'vitest';
import { table } from '../src/reporting/reports/common';

/** Designer Runde 8, 271/274: „in €“ über einer Betragsspalte steht rechts wie die Zahlen; als Zeilenetikett links. */
describe('table', () => {
  it('right-aligns the head „in €“ over amounts, never the label column', () => {
    const head = table('(1fr, 30mm)', ['Datum', 'in €'], []).split('\n')[1]!;
    expect(head).toContain('table.cell(align: right)[#"in €";]');
    const label = table('(1fr, 30mm)', ['in €', 'Summe'], []).split('\n')[1]!;
    expect(label.startsWith('  table.header([#"in €";]')).toBe(true);
  });
});
