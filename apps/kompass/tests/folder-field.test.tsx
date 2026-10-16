// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { FolderField } from '@/components/folder-tree/folder-field';

/**
 * E5 „Ordnerauswahl im Feld“ (Designer 2026-10-17, Notiz `entwuerfe/E5-ordnerbaum.md`): Das Feld klappt den Baum
 * selbst auf — keine Auswahl in einem zweiten Dialog.
 */
const show = (ui: ReactElement) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {ui}
    </NextIntlClientProvider>,
  );
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const folders = [
  { path: 'Behörden', count: 0 },
  { path: 'Behörden/Finanzamt', count: 3 },
  { path: 'Behörden/Ordnungsamt', count: 1 },
  { path: 'Verträge', count: 2 },
];

const field = (props: Partial<Parameters<typeof FolderField>[0]> = {}) => (
  <FolderField value="Behörden/Finanzamt" folders={folders} label="Ordner" emptyLabel="Eingangskorb" rootKind="inbox" variant="field" name="folder" {...props} />
);

describe('FolderField im Feld', () => {
  it('zu: Feldkopf mit Pfad „Behörden › Finanzamt“, aria-expanded, kein Dialog', () => {
    show(field());
    const head = screen.getByRole('button', { name: /Ordner/ });
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(head.textContent).toContain('Behörden');
    expect(head.textContent).toContain('Finanzamt');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('tree')).toBeNull();
  });

  it('auf: Suche hat den Fokus, feste Zeile „Eingangskorb“, Baum mit Beschriftung — ohne zweiten Dialog', async () => {
    show(field());
    fireEvent.click(screen.getByRole('button', { name: /Ordner/ }));
    expect(screen.getByRole('button', { name: /Ordner/ }).getAttribute('aria-expanded')).toBe('true');
    const search = screen.getByRole('searchbox', { name: 'Ordner suchen' });
    await waitFor(() => expect(document.activeElement).toBe(search));
    expect(screen.getByRole('tree')).toBeTruthy();
    expect(screen.getByText('Eingangskorb', { selector: 'button *, button' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Suche filtert und markiert Treffer, ohne Treffer ein Satz', async () => {
    show(field());
    fireEvent.click(screen.getByRole('button', { name: /Ordner/ }));
    const search = screen.getByRole('searchbox', { name: 'Ordner suchen' });
    fireEvent.change(search, { target: { value: 'ordnung' } });
    await waitFor(() => expect(document.querySelector('mark')?.textContent).toBe('Ordnungsamt'));
    expect(within(screen.getByRole('tree')).queryByText('Verträge')).toBeNull();
    fireEvent.change(search, { target: { value: 'xyz' } });
    expect(await screen.findByText('Kein Ordner mit „xyz“.')).toBeTruthy();
  });

  it('Klick auf einen Ordner wählt und klappt zu, der Fokus geht an den Feldkopf; das versteckte Feld trägt den Weg', async () => {
    const onChange = vi.fn();
    const { container } = show(field({ onChange }));
    fireEvent.click(screen.getByRole('button', { name: /Ordner/ }));
    await act(async () => fireEvent.click(within(screen.getByRole('tree')).getByText('Verträge')));
    expect(onChange).toHaveBeenCalledWith('Verträge');
    expect(screen.queryByRole('tree')).toBeNull();
    const head = screen.getByRole('button', { name: /Ordner/ });
    expect(document.activeElement).toBe(head);
    expect((container.querySelector('input[name="folder"]') as HTMLInputElement).value).toBe('Verträge');
  });

  it('Esc klappt zu, ohne zu ändern', async () => {
    const onChange = vi.fn();
    show(field({ onChange }));
    fireEvent.click(screen.getByRole('button', { name: /Ordner/ }));
    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Ordner suchen' }), { key: 'Escape' });
    expect(screen.queryByRole('tree')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('„Neuer Ordner in …“ nur mit Recht (onCreate); legt im markierten Ordner an und wählt ihn', async () => {
    const onCreate = vi.fn(async () => ({ status: 'success' as const }));
    const onChange = vi.fn();
    show(field({ onChange }));
    fireEvent.click(screen.getByRole('button', { name: /Ordner/ }));
    expect(screen.queryByRole('button', { name: /Neuer Ordner/ })).toBeNull();
    cleanup();
    show(field({ onChange, onCreate }));
    fireEvent.click(screen.getByRole('button', { name: /Ordner/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Neuer Ordner in „Finanzamt“' }));
    const input = screen.getByRole('textbox', { name: 'Name des Ordners' });
    fireEvent.change(input, { target: { value: 'Bescheide' } });
    await act(async () => fireEvent.keyDown(input, { key: 'Enter' }));
    expect(onCreate).toHaveBeenCalledWith('Behörden/Finanzamt', 'Bescheide');
    expect(onChange).toHaveBeenCalledWith('Behörden/Finanzamt/Bescheide');
  });

  it('ohne Recht zum Ändern: nur der Ort, kein Feldkopf zum Aufklappen', () => {
    show(field({ readOnly: true }));
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Finanzamt')).toBeTruthy();
  });
});
