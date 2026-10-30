// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import messages from '../messages/de.json';
import { FractionField } from '@/components/governance/fraction-field';
import type { FractionValue } from '@/lib/governance/fraction';

afterEach(cleanup);
const BASES = [
  { value: 'cast' as const, label: 'der abgegebenen Stimmen', sample: 13, sampleLabel: 'Bei 13 abgegebenen Stimmen' },
  { value: 'allMembers' as const, label: 'aller Mitglieder', sample: 42, sampleLabel: 'Bei 42 Mitgliedern' },
];
function Harness({ initial, bases = BASES }: { initial: FractionValue; bases?: typeof BASES }) {
  const [value, setValue] = useState(initial);
  return (
    <NextIntlClientProvider locale="de" messages={messages}>
      <FractionField id="f" label="Satzungsänderung" value={value} onChange={setValue} bases={bases} unit="yes" />
    </NextIntlClientProvider>
  );
}

describe('FractionField (N8)', () => {
  it('is a group named by its label; changing the denominator changes the example', () => {
    render(<Harness initial={{ comparison: 'atLeast', num: 3, den: 4, base: 'cast' }} />);
    const group = screen.getByRole('group', { name: 'Satzungsänderung' });
    const live = group.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toContain('10');
    fireEvent.change(screen.getByLabelText('Nenner'), { target: { value: '3' } });
    expect(live.textContent).not.toContain('10');
    expect(live.textContent).toContain('13');
  });
  it('a numerator above the denominator shows the field error and no example', () => {
    render(<Harness initial={{ comparison: 'atLeast', num: 3, den: 4, base: 'cast' }} />);
    fireEvent.change(screen.getByLabelText('Zähler'), { target: { value: '5' } });
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('group').querySelector('[aria-live="polite"]')!.textContent).toBe('');
  });
  it('offers exactly the given bases', () => {
    render(<Harness initial={{ comparison: 'moreThan', num: 1, den: 2, base: 'cast' }} />);
    const select = screen.getByLabelText('Bezugsgröße') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['cast', 'allMembers']);
  });
});
