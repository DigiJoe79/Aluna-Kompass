// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { EmptyState } from '@/components/empty-state';
import { SectionLevel } from '@/components/section';

const show = (ui: ReactElement) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {ui}
    </NextIntlClientProvider>,
  );

afterEach(cleanup);

describe('EmptyState', () => {
  it('Titel ist eine Überschrift in der Rolle Abschnitt, Ebene aus dem Umfeld (K10 Charge 3)', () => {
    show(<EmptyState title="Ohne Umfeld" text="x" />);
    const h = screen.getByRole('heading', { name: 'Ohne Umfeld', level: 2 });
    expect(h.className.split(/\s+/)).toEqual(expect.arrayContaining(['font-heading', 'text-section']));
    show(<SectionLevel level={3}><EmptyState title="Im Dialog" text="y" /></SectionLevel>);
    expect(screen.getByRole('heading', { name: 'Im Dialog', level: 3 })).toBeTruthy();
  });


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

  it('trägt `data-slot`, gefiltert leer zusätzlich `data-filtered` — daran erkennen E2E-Fälle den Zustand', () => {
    const { container } = show(<EmptyState title="Leer" text="x" />);
    expect(container.querySelector('[data-slot="empty-state"]:not([data-filtered])')).not.toBeNull();
    cleanup();
    const filtered = show(<EmptyState filtered={{ noun: 'Kein Kontakt', resetHref: '/contacts' }} />);
    expect(filtered.container.querySelector('[data-slot="empty-state"][data-filtered]')).not.toBeNull();
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
