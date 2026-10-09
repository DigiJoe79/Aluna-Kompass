// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContactActions } from '@/app/(shell)/contacts/[id]/contact-actions';
import messages from '../messages/de.json';

const deleteContactAction = vi.fn(async (_id: string) => ({ status: 'success' as const }));
vi.mock('@/app/(shell)/contacts/actions', () => ({ deleteContactAction: (id: string) => deleteContactAction(id) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function Intl({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {children}
    </NextIntlClientProvider>
  );
}

afterEach(() => {
  cleanup();
  deleteContactAction.mockClear();
});

const openDelete = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Weitere Aktionen' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Kontakt löschen …' }));
  return screen.findByRole('alertdialog');
};

/** Der Knopf löschte den Kontakt sofort, ohne Rückfrage (Inventar Spec A, 2026-10-07); seit Spec Seitenkopf im Menü ⋯. */
describe('ContactActions', () => {
  it('fragt nach, bevor ein Kontakt nach Ablauf der Frist gelöscht wird', async () => {
    render(<ContactActions contactId="C1" until="2025-12-31" due held={false} />, { wrapper: Intl });
    const dialog = await openDelete();
    expect(deleteContactAction).not.toHaveBeenCalled();
    expect(dialog.textContent).toContain(messages.contacts.retention.confirmText);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Kontakt löschen' }));
    await vi.waitFor(() => expect(deleteContactAction).toHaveBeenCalledWith('C1'));
  });

  it('vor Ablauf nennt der Dialog die Frist und bietet nur „Schließen“', async () => {
    render(<ContactActions contactId="C1" until="2031-12-31" due={false} held />, { wrapper: Intl });
    const dialog = await openDelete();
    expect(dialog.textContent).toContain('bis 31.12.2031');
    expect(within(dialog).queryByRole('button', { name: 'Kontakt löschen' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Schließen' })).toBeTruthy();
  });
});
