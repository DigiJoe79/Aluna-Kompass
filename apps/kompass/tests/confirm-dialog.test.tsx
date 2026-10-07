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

  it('sagt die Folge als Beschreibung des Dialogs, in der Stufe body (K10 § 4.2, Review Focus 2)', () => {
    render(<ConfirmDialog open onOpenChange={vi.fn()} title="Eintrag löschen?" description="Der Eintrag wird entfernt." confirmLabel="Löschen" action={async () => ({ status: 'success' })} />, { wrapper });
    const dialog = screen.getByRole('alertdialog', { name: 'Eintrag löschen?' });
    const described = document.getElementById(dialog.getAttribute('aria-describedby') ?? '');
    expect(described?.textContent).toBe('Der Eintrag wird entfernt.');
    expect(described?.className.split(' ')).toEqual(expect.arrayContaining(['text-body', 'text-ink-2']));
    expect(screen.getByRole('heading', { name: 'Eintrag löschen?' }).className).not.toContain('text-[19px]');
  });

  it('verlangt eine Beschreibung', () => {
    // @ts-expect-error — ohne description übersetzt ConfirmDialog nicht (K10 § 4.2).
    void (<ConfirmDialog open onOpenChange={() => {}} title="T" confirmLabel="OK" action={async () => ({ status: 'success' as const })} />);
  });
});
