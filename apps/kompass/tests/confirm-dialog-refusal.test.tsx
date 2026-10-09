// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {children}
    </NextIntlClientProvider>
  );
}

afterEach(cleanup);

describe('ConfirmDialog refusal', () => {
  it('bei refusal: Begründung ist die Beschreibung, nur „Schließen“ mit Fokus, keine Aktion', async () => {
    const action = vi.fn();
    render(<ConfirmDialog open onOpenChange={() => {}} title="Kontakt löschen?" description="unbenutzt" confirmLabel="Löschen" destructive action={action} refusal={{ message: 'Aufbewahrung bis 31.12.2031.' }} />, { wrapper });
    const dialog = await screen.findByRole('alertdialog', { name: 'Kontakt löschen?', description: /Aufbewahrung bis 31\.12\.2031/ });
    expect(within(dialog).queryByRole('button', { name: 'Löschen' })).toBeNull();
    expect(within(dialog).queryByText('unbenutzt')).toBeNull();
    const close = within(dialog).getByRole('button', { name: 'Schließen' });
    await waitFor(() => expect(document.activeElement).toBe(close));
    expect(action).not.toHaveBeenCalled();
  });
});
