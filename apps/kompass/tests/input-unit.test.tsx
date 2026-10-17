// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Input } from '@/components/ui/input';

/**
 * Einheit im Feld (Designer Runde 3: 065, 085, 121, 124, 125, 172, 181, 182): „€“, „Monate“, „Tage“ stehen rechts im
 * Feld, wie beim Betragsfeld — nicht als loser Text daneben.
 */
afterEach(cleanup);

describe('Input unit', () => {
  it('ohne Einheit bleibt es ein einzelnes Feld', () => {
    const { container } = render(<Input aria-label="Name" />);
    expect(container.firstElementChild!.tagName).toBe('INPUT');
  });

  it('mit Einheit steht sie rechts im selben Rahmen; die Breite gilt dem Rahmen', () => {
    const { container } = render(<Input aria-label="Betrag ab" unit="€" className="w-24" />);
    const frame = container.firstElementChild!;
    expect(frame.getAttribute('data-slot')).toBe('input-unit');
    expect(frame.className).toContain('w-24');
    expect(frame.lastElementChild!.textContent).toBe('€');
    expect(screen.getByRole('textbox', { name: 'Betrag ab' }).className).not.toContain('w-24');
  });
});
