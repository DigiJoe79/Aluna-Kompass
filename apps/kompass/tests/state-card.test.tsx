// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { EmptyState } from '@/components/empty-state';
import { ForbiddenCard } from '@/components/forbidden-card';

vi.mock('@/components/hydration-marker', () => ({ HydrationMarker: () => null }));

const show = (ui: ReactElement) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {ui}
    </NextIntlClientProvider>,
  );

afterEach(cleanup);

// Eine Zustandskarte für 404, 403 und „Modul aus“ (Designer Stufe 2 Nr. 13, Z13): die Leerzustandskarte als Variante
// `state` — Marke, Titel, Text, höchstens zwei Aktionen, primär rechts; feste Breite, kein fester Leerraum.
describe('EmptyState state', () => {
  it('Marke, Titel als h1, Text, zwei Aktionen mit der primären rechts', () => {
    const { container } = show(
      <EmptyState state={{ mark: '404', title: 'Diese Seite gibt es nicht.', text: 'Prüfen Sie die Adresse.', primary: <a href="/">Startseite</a>, secondary: <a href="/admin/audit">Protokoll öffnen</a> }} />,
    );
    const h1 = screen.getByRole('heading', { level: 1, name: 'Diese Seite gibt es nicht.' });
    expect(h1.className.split(/\s+/)).toEqual(expect.arrayContaining(['font-heading', 'text-page-title']));
    expect(screen.getByText('404')).toBeTruthy();
    const links = screen.getAllByRole('link').map((a) => a.textContent);
    expect(links).toEqual(['Protokoll öffnen', 'Startseite']);
    expect(container.innerHTML).not.toMatch(/min-h-\[320px\]|mt-auto/);
    expect(container.querySelector('section')!.className).toContain('max-w-task');
  });
});

describe('ForbiddenCard', () => {
  it('nennt das Recht im Klartext, den Schlüssel darunter, und sagt den Satz nur einmal (01 B15)', () => {
    show(<ForbiddenCard permission="roles.manage" />);
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
    expect(document.body.textContent).toContain('Rollen verwalten');
    expect(screen.getByText('roles.manage').className).toContain('font-mono');
    expect(document.body.textContent).not.toContain('Rechte ändert die Administration unter Rollen.');
  });
});

describe('404 je nach Ursache (01 A3)', () => {
  it('unbekannte Adresse und fehlender Eintrag haben eigene Texte', () => {
    expect(messages.errors.pages.routeNotFound.title).toBe('Diese Seite gibt es nicht.');
    expect(messages.errors.pages.notFound.title).toBe('Diesen Eintrag gibt es nicht mehr.');
  });
});
