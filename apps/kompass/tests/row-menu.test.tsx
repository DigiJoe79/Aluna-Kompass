// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { RowMenu } from '@/components/row-menu';

/**
 * Zeilenaktionen im ⋯-Menü (Joe 11.8, Designer Runde 3 Teil 1 Nr. 2; MUSTER § G): auf allen Breiten, auch bei einer
 * Aktion. Das Menü ist per Tastatur bedienbar und hat einen Namen für Vorleser („Aktionen für …“).
 */
function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {children}
    </NextIntlClientProvider>
  );
}
afterEach(cleanup);

describe('RowMenu', () => {
  it('heißt „Aktionen für …“ und öffnet auch bei einer Aktion ein Menü; die Wahl ruft onSelect', async () => {
    const edit = vi.fn();
    render(<RowMenu name="Girokonto" items={[{ key: 'edit', label: 'Bearbeiten', onSelect: edit }]} />, { wrapper });
    const trigger = screen.getByRole('button', { name: 'Aktionen für Girokonto' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Bearbeiten' }));
    expect(edit).toHaveBeenCalledTimes(1);
  });

  it('ohne sichtbaren Eintrag kein Knopf', () => {
    const { container } = render(<RowMenu name="X" items={[{ key: 'delete', label: 'Löschen', onSelect: vi.fn(), hidden: true }]} />, { wrapper });
    expect(container.innerHTML).toBe('');
  });

  it('ein gesperrter Eintrag bleibt sichtbar und nennt den Grund', async () => {
    render(<RowMenu name="Brief" items={[{ key: 'delete', label: 'Löschen', onSelect: vi.fn(), disabledReason: 'Wird noch verwendet.' }]} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Aktionen für Brief' }));
    const item = await screen.findByRole('menuitem', { name: /Löschen/ });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.textContent).toContain('Wird noch verwendet.');
  });

  it('Löschen steht zuletzt, durch eine Linie getrennt', async () => {
    render(
      <RowMenu
        name="Regel"
        items={[
          { key: 'delete', label: 'Löschen', onSelect: vi.fn(), kind: 'delete' },
          { key: 'edit', label: 'Bearbeiten', onSelect: vi.fn() },
        ]}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Aktionen für Regel' }));
    await screen.findByRole('menuitem', { name: 'Bearbeiten' });
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Bearbeiten', 'Löschen']);
    expect(screen.getByRole('separator')).toBeTruthy();
  });
});
