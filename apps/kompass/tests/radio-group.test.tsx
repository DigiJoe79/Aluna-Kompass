// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { matchingLines, read, relative, sourceFiles } from './patterns/source';

afterEach(cleanup);

/**
 * `RadioGroup` (Freigabe Joe 05.10.2026, HANDOFF Konsistenz § 8c): zwei bis vier kurze Optionen, wo
 * `ChoiceCards` zu schwer wäre. Native Radios fallen im Dunkelmodus aus dem Bild; der Baustein zeichnet den
 * Kreis selbst, nur mit Theme-Tokens.
 */
function Example({ initial = 'a' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <RadioGroup aria-label="Art" value={value} onValueChange={setValue}>
        <label>
          <RadioGroupItem value="a" />
          Person
        </label>
        <label>
          <RadioGroupItem value="b" />
          Organisation
        </label>
      </RadioGroup>
      <output>{value}</output>
    </>
  );
}

describe('RadioGroup', () => {
  it('ist eine benannte Radiogruppe mit einem Radio je Option', () => {
    render(<Example />);
    expect(screen.getByRole('radiogroup', { name: 'Art' })).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('das Label wählt die Option, der gewählte Wert steht an genau einem Radio', () => {
    render(<Example />);
    fireEvent.click(screen.getByRole('radio', { name: 'Organisation' }));
    expect(document.querySelector('output')!.textContent).toBe('b');
    expect(screen.getByRole('radio', { name: 'Organisation' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Person' }).getAttribute('aria-checked')).toBe('false');
  });

  it('zeichnet den Kreis mit Theme-Tokens statt nativ', () => {
    render(<Example />);
    const radio = screen.getByRole('radio', { name: 'Person' });
    expect(radio.tagName).not.toBe('INPUT');
    expect(radio.className).toContain('border-line-strong');
    expect(radio.className).toContain('data-checked:border-brand');
  });
});

/**
 * Nach dem Umzug (Plan K8/K9 T6) gibt es keine sichtbaren nativen Radios mehr: Auswahl in Karten über
 * `ChoiceCards`, kurze Optionen über `RadioGroup`.
 */
const NATIVE_ALLOWED: Record<string, string> = {
  'components/choice-cards.tsx': 'Karten-Auswahl; das native Radio ist unsichtbar, die Karte zeichnet den Zustand.',
  'app/(shell)/finance/expenses/new/position-card.tsx':
    'Umschalter Beleg/Fahrt als Segmentleiste; das native Radio liegt unsichtbar (`opacity-0`) über dem Segment.',
};

describe('keine nativen Radios', () => {
  it('type="radio" steht nur in der Erlaubnisliste', () => {
    const hits = sourceFiles().flatMap((file) => (relative(file) in NATIVE_ALLOWED ? [] : matchingLines(file, read(file), /type="radio"/)));
    expect(hits).toEqual([]);
  });
});
