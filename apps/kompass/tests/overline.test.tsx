// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Overline } from '@/components/overline';

afterEach(cleanup);

describe('Overline', () => {
  it('ist ein Absatz in der Rolle Etikett, Versalien, gedämpft', () => {
    render(<Overline>Summe Geld</Overline>);
    const el = screen.getByText('Summe Geld');
    expect(el.tagName).toBe('P');
    expect(el.className.split(/\s+/)).toEqual(expect.arrayContaining(['text-label', 'uppercase', 'text-muted-ink']));
  });

  it.each(['dt', 'span', 'div'] as const)('rendert als %s', (as) => {
    render(as === 'dt' ? <dl><Overline as="dt">X</Overline></dl> : <Overline as={as}>X</Overline>);
    expect(screen.getByText('X').tagName).toBe(as.toUpperCase());
  });

  it('ist keine Überschrift', () => {
    render(<Overline>Gruppe</Overline>);
    expect(screen.queryByRole('heading')).toBeNull();
  });
});
