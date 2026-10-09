// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { Table, TableBody, TableGroupRow } from '@/components/ui/table';

afterEach(cleanup);

it('TableGroupRow ist ein Kopf über die ganze Gruppe', () => {
  render(
    <Table>
      <TableBody>
        <TableGroupRow colSpan={3} testId="g">Finanzen</TableGroupRow>
      </TableBody>
    </Table>,
  );
  const head = screen.getByRole('columnheader', { name: 'Finanzen' });
  expect(head.getAttribute('colspan')).toBe('3');
  expect(head.getAttribute('scope')).toBe('colgroup');
  expect(screen.getByTestId('g').tagName).toBe('TR');
});
