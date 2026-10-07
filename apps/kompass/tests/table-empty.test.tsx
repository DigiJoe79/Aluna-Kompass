// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Table, TableBody, TableEmpty } from '@/components/ui/table';

afterEach(cleanup);

/** K10 Charge 1, § 4.4: eine Zeile, eine Zelle im Ton von `EmptyState`. */
describe('TableEmpty', () => {
  it('füllt die Breite der Tabelle mit einem Satz im Ton von EmptyState', () => {
    render(<Table><TableBody><TableEmpty colSpan={4}>Noch keine Bausteine.</TableEmpty></TableBody></Table>);
    const cell = screen.getByText('Noch keine Bausteine.');
    expect(cell.tagName).toBe('TD');
    expect(cell.getAttribute('colspan')).toBe('4');
    const cls = cell.className.split(' ');
    expect(cls).toEqual(expect.arrayContaining(['py-6', 'text-center', 'text-meta', 'text-muted-ink']));
    expect(cls).not.toContain('py-[var(--row-pad-density,0.5rem)]');
  });

  it('bricht einen langen Satz um, statt die Tabelle zu verbreitern (Review Focus 5)', () => {
    render(<Table><TableBody><TableEmpty colSpan={2}>Ein langer Satz.</TableEmpty></TableBody></Table>);
    const cls = screen.getByText('Ein langer Satz.').className.split(' ');
    expect(cls).toContain('whitespace-normal');
    expect(cls).not.toContain('whitespace-nowrap');
  });
});
