// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CountField } from '@/components/count-field';

/** Zählfeld (N1, Designer 2026-10-23 `zaehlfelder`): Rahmen fester Breite, Zahl rechtsbündig, Einheit als Text dahinter. */
afterEach(cleanup);

describe('CountField', () => {
  it('Zahl rechtsbündig im festen Rahmen, die Einheit als Text dahinter beschreibt das Feld', () => {
    render(<CountField id="ring-weekly" aria-label="Wöchentliche Backups behalten" unit="wöchentliche" defaultValue={4} />);
    const field = screen.getByRole('spinbutton', { name: 'Wöchentliche Backups behalten' });
    expect(field.className).toContain('w-20');
    expect(field.className).toContain('text-right');
    // Ohne Pfeile: Chrome hielte ihnen sonst Platz frei, und die Zahl stünde in der Mitte (Joe 2026-10-23).
    expect(field.className).toContain('[appearance:textfield]');
    const unit = document.getElementById(field.getAttribute('aria-describedby')!.split(' ')[0]!);
    expect(unit?.textContent).toBe('wöchentliche');
    expect(unit?.closest('[data-slot="input"]')).toBeNull();
  });

  it('Einzahl und Mehrzahl nach dem Wert', () => {
    const { rerender } = render(<CountField id="d" aria-label="Tage" unit={{ one: 'Tag', other: 'Tage' }} value={1} onChange={() => {}} />);
    expect(screen.getByText('Tag')).toBeTruthy();
    rerender(<CountField id="d" aria-label="Tage" unit={{ one: 'Tag', other: 'Tage' }} value={28} onChange={() => {}} />);
    expect(screen.getByText('Tage')).toBeTruthy();
  });

  it('eine vorhandene Beschreibung bleibt erhalten', () => {
    render(<CountField id="f" aria-label="Frist" unit="Tage" defaultValue={30} aria-describedby="f-hint" />);
    expect(screen.getByRole('spinbutton').getAttribute('aria-describedby')).toBe('f-unit f-hint');
  });
});
