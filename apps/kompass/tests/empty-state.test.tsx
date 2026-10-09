// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { EmptyState } from '@/components/empty-state';

const show = (ui: ReactElement) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {ui}
    </NextIntlClientProvider>,
  );

afterEach(cleanup);

describe('EmptyState', () => {
  it('ganz leer: Titel, Text und Aktion des Aufrufers', () => {
    show(<EmptyState title="Noch keine Buchung." text="Legen Sie die erste an." action={<a href="/new">Neue Buchung</a>} />);
    expect(screen.getByRole('heading', { name: 'Noch keine Buchung.' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Neue Buchung' })).toBeTruthy();
  });

  it('gefiltert leer mit Knopf: Satz, „Filter zurücksetzen“, kein Anlegen', () => {
    const onReset = vi.fn();
    show(<EmptyState filtered={{ noun: 'Kein Kontakt', onReset }} />);
    expect(screen.getByRole('heading', { name: 'Kein Kontakt passt zu diesen Filtern.' })).toBeTruthy();
    expect(screen.getByText('Ändern Sie die Suche oder setzen Sie die Filter zurück.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Noch keine|anlegen|Neue/)).toBeNull();
  });

  it('gefiltert leer mit Adresse: „Filter zurücksetzen“ ist ein Link', () => {
    show(<EmptyState filtered={{ noun: 'Keine Buchung', resetHref: '/finance/entries' }} />);
    expect(screen.getByRole('link', { name: 'Filter zurücksetzen' }).getAttribute('href')).toBe('/finance/entries');
  });

  it('gefiltert leer mit eigenem Text: der Text ersetzt den Standardsatz (Protokoll, Designer 2026-10-09)', () => {
    show(<EmptyState filtered={{ noun: 'Kein Eintrag', resetHref: '/admin/audit', text: 'Personen finden Sie über den Filter „Nutzer“.' }} />);
    expect(screen.getByText('Personen finden Sie über den Filter „Nutzer“.')).toBeTruthy();
    expect(screen.queryByText('Ändern Sie die Suche oder setzen Sie die Filter zurück.')).toBeNull();
    expect(screen.getByRole('link', { name: 'Filter zurücksetzen' })).toBeTruthy();
  });
});
