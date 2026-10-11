// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { KeyLine } from '@/components/key-line';

afterEach(cleanup);

it('KeyLine: Schlüssel als eigene Zeile, mono, Rolle key, gedämpft', () => {
  render(<KeyLine>finance.approve</KeyLine>);
  const el = screen.getByText('finance.approve');
  expect(el.tagName).toBe('SPAN');
  expect(el.className.split(/\s+/)).toEqual(expect.arrayContaining(['block', 'font-mono', 'text-key', 'text-muted-ink']));
});
