// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DocumentMailDraft, OutboxListItem } from '@kompass/module-dms';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DispatchPanel } from '@/app/(shell)/dms/[id]/dispatch-panel';
import { DateFormatProvider } from '@/components/date-format-provider';
import messages from '../messages/de.json';

const actions = vi.hoisted(() => ({ resendDocumentMailAction: vi.fn(), recordDispatchAction: vi.fn(), clearDispatchAction: vi.fn() }));
vi.mock('@/app/(shell)/dms/actions', () => actions);
vi.mock('@/app/(shell)/dms/[id]/mail-send-dialog', () => ({ MailSendDialog: () => null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <DateFormatProvider mode="locale" timeZone="Europe/Berlin">{children}</DateFormatProvider>
    </NextIntlClientProvider>
  );
}

const failed: OutboxListItem = {
  id: 'O1',
  documentId: 'D1',
  documentNumber: 'B-2026-001',
  documentSubject: 'Brief',
  contactId: 'C1',
  contactName: 'Erika Beispiel',
  toAddress: 'erika@example.org',
  status: 'failed',
  attempts: 3,
  lastErrorCode: '550',
  lastErrorText: 'Postfach unbekannt',
  queuedAt: '2026-10-27T08:00:00.000Z',
  queuedByUserId: null,
  sentAt: null,
  runRef: null,
};

const mail: DocumentMailDraft = {
  documentId: 'D1',
  documentNumber: 'B-2026-001',
  subject: 'Brief',
  fileName: 'b.pdf',
  fileBytes: 1000,
  bodySnippetId: null,
  mail: { kind: 'ready', redirectTo: null, sender: true },
  recipients: [],
  sendings: [failed],
};

describe('Versand — „Erneut senden“ (App-B2)', () => {
  it('ein Doppelklick reiht die Mail einmal ein; der Knopf ist gesperrt, solange es läuft', async () => {
    let resolve!: (v: unknown) => void;
    actions.resendDocumentMailAction.mockImplementation(() => new Promise((res) => (resolve = res)));
    render(<DispatchPanel documentId="D1" sentAt={null} sentVia={null} sentNote={null} channels={[{ key: 'post', label: 'Post' }]} today="2026-10-28" canEdit={false} mail={mail} canSend />, { wrapper });
    const button = screen.getByTestId('dispatch-resend') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(actions.resendDocumentMailAction).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    await act(async () => {
      resolve({ status: 'error', message: 'Schon unterwegs.', fieldErrors: {} });
    });
    expect((screen.getByTestId('dispatch-resend') as HTMLButtonElement).disabled).toBe(false);
  });
});
