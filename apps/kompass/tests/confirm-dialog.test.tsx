// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

describe('ConfirmDialog', () => {
  it('bleibt bei Ablehnung offen und zeigt den Grund im Dialog (Review Focus 1)', async () => {
    const onOpenChange = vi.fn();
    render(<ConfirmDialog open onOpenChange={onOpenChange} title="Festschreiben" description="…" confirmLabel="Festschreiben"
      action={async () => ({ status: 'error', message: 'Zeitraum ist geschlossen.', fieldErrors: {} })} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Festschreiben' }));
    expect(await screen.findByText('Zeitraum ist geschlossen.')).toBeTruthy();
    expect(screen.getByText('Nicht möglich')).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('schließt bei Erfolg', async () => {
    const onOpenChange = vi.fn();
    render(<ConfirmDialog open onOpenChange={onOpenChange} title="T" description="D" confirmLabel="OK" action={async () => ({ status: 'success' })} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('zeigt nach erneutem Öffnen keine alte Ablehnung', async () => {
    const props = { onOpenChange: vi.fn(), title: 'T', description: 'D', confirmLabel: 'OK', action: async () => ({ status: 'error' as const, message: 'Nein.', fieldErrors: {} }) };
    const { rerender } = render(<ConfirmDialog open {...props} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await screen.findByText('Nein.');
    rerender(<ConfirmDialog open={false} {...props} />);
    rerender(<ConfirmDialog open {...props} />);
    expect(screen.queryByText('Nein.')).toBeNull();
  });

  it('räumt die Ablehnung beim erneuten Bestätigen zuerst ab und schließt dann bei Erfolg', async () => {
    const onOpenChange = vi.fn();
    const action = vi.fn()
      .mockResolvedValueOnce({ status: 'error', message: 'Noch gesperrt.', fieldErrors: {} })
      .mockResolvedValueOnce({ status: 'success' });
    render(<ConfirmDialog open onOpenChange={onOpenChange} title="T" description="D" confirmLabel="OK" action={action} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await screen.findByText('Noch gesperrt.');
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(screen.queryByText('Noch gesperrt.')).toBeNull();
  });
});
