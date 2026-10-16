// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { DraftActions } from '@/app/(shell)/finance/expenses/new/draft-actions';

const deleteExpenseDraftAction = vi.fn(async (_id: string) => ({ status: 'success' as const }));
const push = vi.fn();
vi.mock('@/app/(shell)/finance/expenses/actions', () => ({ deleteExpenseDraftAction: (id: string) => deleteExpenseDraftAction(id) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(cleanup);

/** Auslagen-Entwurf löschen (08 A2, Joe 2026-10-16): im Seitenkopf über ⋯, mit Rückfrage; kein automatisches Verwerfen. */
describe('DraftActions', () => {
  it('löscht den Entwurf erst nach der Rückfrage und führt zur Liste', async () => {
    render(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <DraftActions id="C1" />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Weitere Aktionen' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Entwurf löschen …' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(deleteExpenseDraftAction).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Entwurf löschen' }));
    await waitFor(() => expect(deleteExpenseDraftAction).toHaveBeenCalledWith('C1'));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/finance/expenses'));
  });
});
