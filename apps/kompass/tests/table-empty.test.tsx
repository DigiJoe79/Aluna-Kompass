// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Table, TableBody, TableEmpty } from '@/components/ui/table';

afterEach(cleanup);

/** K10 Charge 1, § 4.4: eine Zeile, eine Zelle. */
describe('TableEmpty', () => {
  it('füllt die Breite der Tabelle mit einer Zelle', () => {
    render(<Table><TableBody><TableEmpty colSpan={4}>Noch keine Bausteine.</TableEmpty></TableBody></Table>);
    const cell = screen.getByText('Noch keine Bausteine.');
    expect(cell.tagName).toBe('TD');
    expect(cell.getAttribute('colspan')).toBe('4');
  });
});
