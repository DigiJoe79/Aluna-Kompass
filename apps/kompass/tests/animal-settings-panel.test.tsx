// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

const save = vi.hoisted(() => vi.fn(async () => ({ status: 'success', message: 'Einstellungen gespeichert.' }) as unknown));
vi.mock('@/app/(shell)/admin/animals/actions', () => ({ saveAnimalSettingsAction: save }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), dismiss: vi.fn() }) }));

import { AnimalSettingsPanel } from '@/app/(shell)/admin/animals/settings-panel';

function Intl({ children }: { children: ReactNode }) {
  return <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">{children}</NextIntlClientProvider>;
}
afterEach(cleanup);

const initial = { frame: { aspect: '4:3', focusX: 50, focusY: 50 }, profileUrl: '', proposalsEnabled: false, reviewOnMcpWrite: false, photoFolder: '', stackEnabled: false };
const folders = [
  { path: 'Tierfotos', count: 4 },
  { path: 'Tierfotos/Rumänien', count: 2 },
];
const confirmButton = () => within(screen.getByRole('dialog')).getAllByRole('button').find((b) => b.dataset.testid === 'folder-move-confirm')!;

/** Wählt den Ordner im Dialog, wie man es mit der Maus tut. */
async function pickFolder(name: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: 'Ändern…' }));
  await screen.findAllByRole('treeitem');
  fireEvent.click(screen.getByRole('treeitem', { name }));
  await act(async () => fireEvent.click(confirmButton()));
}

describe('AnimalSettingsPanel: proposals, review mark, photo folder', () => {
  it('saves the two switches and the folder with the rest and counts each as a change', async () => {
    render(<AnimalSettingsPanel initial={initial} folders={folders} canManage />, { wrapper: Intl });
    fireEvent.click(screen.getByRole('switch', { name: 'Vorschläge von Quellen annehmen' }));
    expect(document.querySelector('[data-folder-path]')!.textContent).toBe('Oberste Ebene');
    await pickFolder(/^Tierfotos,/);
    expect(document.querySelector('[data-folder-path]')!.textContent).toBe('Tierfotos');
    expect(screen.getByText('2 Änderungen noch nicht gespeichert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ proposalsEnabled: true, reviewOnMcpWrite: false, photoFolder: 'Tierfotos' })));
  });

  it('shows a refused folder at the field', async () => {
    save.mockResolvedValueOnce({ status: 'error', message: 'x', fieldErrors: { photoFolder: 'Kein gültiger Ordnerpfad.' } });
    render(<AnimalSettingsPanel initial={initial} folders={folders} canManage />, { wrapper: Intl });
    await pickFolder(/^Tierfotos,/);
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(screen.getByText('Kein gültiger Ordnerpfad.')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Ändern…' }).getAttribute('aria-invalid')).toBe('true');
  });

  it('names a stored folder that is gone from the library and lets it be picked anew', async () => {
    render(<AnimalSettingsPanel initial={{ ...initial, photoFolder: 'Alt/Hunde' }} folders={folders} canManage />, { wrapper: Intl });
    expect(screen.getByText('Den Ordner „Hunde“ gibt es in der Mediathek nicht mehr. Bis Sie einen anderen wählen, landen die Fotos auf der obersten Ebene.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ändern…' }).getAttribute('aria-invalid')).toBe('true');
    await pickFolder(/^Tierfotos,/);
    expect(screen.queryByText(/gibt es in der Mediathek nicht mehr/)).toBeNull();
  });

  it('shows the folder without a button for someone who may not change it', () => {
    render(<AnimalSettingsPanel initial={{ ...initial, photoFolder: 'Tierfotos/Rumänien' }} folders={folders} canManage={false} />, { wrapper: Intl });
    expect(document.querySelector('[data-folder-path]')!.textContent).toBe('Tierfotos › Rumänien');
    expect(screen.queryByRole('button', { name: 'Ändern…' })).toBeNull();
  });

  it('has the review switch', () => {
    render(<AnimalSettingsPanel initial={{ ...initial, reviewOnMcpWrite: true }} folders={folders} canManage />, { wrapper: Intl });
    expect(screen.getByRole('switch', { name: 'Schreiben über MCP zur Prüfung vormerken' }).getAttribute('aria-checked')).toBe('true');
  });

  it('saves the switch for walking through proposals in a stack', async () => {
    render(<AnimalSettingsPanel initial={initial} folders={folders} canManage />, { wrapper: Intl });
    fireEvent.click(screen.getByRole('switch', { name: 'Vorschläge im Stapel durchgehen' }));
    expect(screen.getByText('1 Änderung noch nicht gespeichert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ stackEnabled: true })));
  });
});
