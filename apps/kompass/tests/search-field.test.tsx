// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { SearchField } from '@/components/search-field';
import { Command, CommandInput } from '@/components/ui/command';

const wrap = (ui: ReactElement) => (
  <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
    {ui}
  </NextIntlClientProvider>
);
const show = (ui: ReactElement) => render(wrap(ui));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('SearchField', () => {
  it('hat den Namen „Suchen“, die Lupe ist Schmuck, der Platzhalter nennt die Felder', () => {
    const { container } = show(<SearchField value="" onChange={vi.fn()} placeholder="Name suchen" />);
    const box = screen.getByRole('searchbox', { name: 'Suchen' });
    expect(box.getAttribute('placeholder')).toBe('Name suchen');
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('ruft onChange erst nach 250 ms, mit dem letzten Wert', () => {
    const onChange = vi.fn();
    show(<SearchField value="" onChange={onChange} placeholder="x" />);
    const box = screen.getByRole('searchbox', { name: 'Suchen' });
    fireEvent.change(box, { target: { value: 'Lu' } });
    fireEvent.change(box, { target: { value: 'Luna' } });
    act(() => vi.advanceTimersByTime(249));
    expect(onChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('Luna');
  });

  it('meldet an das jüngste onChange: ein Filter, der während der Verzögerung wechselt, geht nicht verloren', () => {
    const first = vi.fn();
    const latest = vi.fn();
    const { rerender } = show(<SearchField value="123" onChange={first} placeholder="x" />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Suchen' }), { target: { value: '' } });
    rerender(wrap(<SearchField value="123" onChange={latest} placeholder="x" />));
    act(() => vi.advanceTimersByTime(250));
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledExactlyOnceWith('');
  });

  it('✕ erscheint nur mit Text, leert sofort und lässt den Fokus im Feld', () => {
    const onChange = vi.fn();
    show(<SearchField value="Luna" onChange={onChange} placeholder="x" />);
    fireEvent.click(screen.getByRole('button', { name: 'Suche leeren' }));
    expect(onChange).toHaveBeenCalledWith('');
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Suchen' }));
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
    cleanup();
    show(<SearchField value="" onChange={onChange} placeholder="x" />);
    expect(screen.queryByRole('button', { name: 'Suche leeren' })).toBeNull();
  });

  it('✕ verwirft einen noch nicht gesendeten Wert', () => {
    const onChange = vi.fn();
    show(<SearchField value="" onChange={onChange} placeholder="x" />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Lu' } });
    fireEvent.click(screen.getByRole('button', { name: 'Suche leeren' }));
    act(() => vi.advanceTimersByTime(500));
    expect(onChange.mock.calls).toEqual([['']]);
  });

  it('folgt einem Wert von außen (Zurück-Knopf), ohne Tippen zu überschreiben', () => {
    const onChange = vi.fn();
    const { rerender } = show(<SearchField value="a" onChange={onChange} placeholder="x" />);
    rerender(wrap(<SearchField value="b" onChange={onChange} placeholder="x" />));
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('b');
    // Getippt und gesendet, dann weitergetippt: Die nachlaufende Adresse bringt den gesendeten Wert zurück.
    const box = screen.getByRole('searchbox');
    fireEvent.change(box, { target: { value: 'Luna' } });
    act(() => vi.advanceTimersByTime(250));
    fireEvent.change(box, { target: { value: 'Luna B' } });
    rerender(wrap(<SearchField value="Luna" onChange={onChange} placeholder="x" />));
    expect((box as HTMLInputElement).value).toBe('Luna B');
  });
});

describe('CommandInput', () => {
  it('✕ „Suche leeren“ erscheint mit Text, leert und behält den Fokus', () => {
    const onValueChange = vi.fn();
    show(
      <Command>
        <CommandInput aria-label="Kontakt" value="Anna" onValueChange={onValueChange} />
      </Command>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Suche leeren' }));
    expect(onValueChange).toHaveBeenCalledWith('');
    expect(document.activeElement).toBe(screen.getByLabelText('Kontakt'));
  });

  it('ohne gesteuerten Wert (Palette): ✕ nach dem Tippen, leert das Feld', () => {
    show(
      <Command>
        <CommandInput aria-label="Palette" />
      </Command>,
    );
    expect(screen.queryByRole('button', { name: 'Suche leeren' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Palette'), { target: { value: 'Hund' } });
    fireEvent.click(screen.getByRole('button', { name: 'Suche leeren' }));
    expect((screen.getByLabelText('Palette') as HTMLInputElement).value).toBe('');
  });
});
