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
// `state` — Marke, Titel, Text, höchstens zwei Aktionen, primär rechts.
describe('EmptyState state', () => {
  it('Marke, Titel als h1, Text, zwei Aktionen mit der primären rechts', () => {
    show(
      <EmptyState state={{ mark: '404', title: 'Diese Seite gibt es nicht.', text: 'Prüfen Sie die Adresse.', primary: <a href="/">Startseite</a>, secondary: <a href="/admin/audit">Protokoll öffnen</a> }} />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Diese Seite gibt es nicht.' })).toBeTruthy();
    expect(screen.getByText('404')).toBeTruthy();
    const links = screen.getAllByRole('link').map((a) => a.textContent);
    expect(links).toEqual(['Protokoll öffnen', 'Startseite']);
  });
});

describe('ForbiddenCard', () => {
  it('nennt das Recht im Klartext und den Schlüssel (01 B15)', () => {
    show(<ForbiddenCard permission="roles.manage" />);
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
    expect(document.body.textContent).toContain('Rollen verwalten');
  });
});
