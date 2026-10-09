// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TransferForm } from '@/app/(shell)/finance/purposes/transfer/transfer-form';
import messages from '../messages/de.json';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/app/(shell)/finance/purposes/actions', () => ({ requestPurposeTransferAction: vi.fn(), requestPurposeTransferUploadAction: vi.fn() }));
vi.mock('@/app/(shell)/dms/document-picker', () => ({ DocumentPicker: () => null }));

function Intl({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {children}
    </NextIntlClientProvider>
  );
}

afterEach(cleanup);

const unload = () => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

/**
 * Befund 41: Die Umwidmung zeigt links in der Leiste, wer freigeben kann — der Zähler bleibt verborgen, zählt aber
 * mit, damit die Seite beim Verlassen nur nach einer Eingabe nachfragt.
 */
describe('TransferForm – Rückfrage beim Verlassen', () => {
  const form = () => (
    <TransferForm purposes={[{ id: 'P1', name: 'Kastration', open: true, balanceCents: 50000 }]} today="2026-10-09" approverNames={['Erika Muster']} />
  );

  it('fragt ohne Eingabe nicht, nach einer Eingabe schon; der Hinweis bleibt stehen, Verwerfen setzt zurück', () => {
    render(form(), { wrapper: Intl });
    expect(unload()).toBe(false);

    fireEvent.change(screen.getByLabelText(/Begründung/), { target: { value: 'Zweck erfüllt' } });
    expect(unload()).toBe(true);
    expect(screen.getByTestId('transfer-approvers').textContent).toContain('Erika Muster');
    expect(screen.queryByText(/nicht gespeichert/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Verwerfen' }));
    expect(unload()).toBe(false);
    expect((screen.getByLabelText(/Begründung/) as HTMLTextAreaElement).value).toBe('');
  });
});
