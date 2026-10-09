// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoticesTable, type NoticeRow } from '@/app/(shell)/finance/donations/notices/notices-table';
import messages from '../messages/de.json';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/(shell)/finance/donations/notices/actions', () => ({ supersedeNoticeAction: vi.fn(), voidNoticeAction: vi.fn() }));
vi.mock('@/app/(shell)/finance/donations/notices/notice-dialog', () => ({ NoticeDialog: () => null }));
vi.mock('@/app/(shell)/dms/document-picker', () => ({ DocumentPicker: () => null }));

function Intl({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {children}
    </NextIntlClientProvider>
  );
}

afterEach(cleanup);

const row = (over: Partial<NoticeRow> = {}): NoticeRow =>
  ({ id: 'N1', kind: 'exemptionNotice', taxOffice: 'Finanzamt Musterstadt', taxNumber: '99/999/99999', noticeDate: '2025-05-02', exemptFrom: '2023-01-01', assessmentPeriod: '2023', purposesText: 'x', purposesTextAccusative: 'x', validUntil: '2030-05-02', state: 'valid', supersededOn: null, voidedAt: null, documentId: null, documentNumber: null, supersededDocumentNumber: null, ...over }) as NoticeRow;

/** Backlog 36: Bis zu drei Aktionen standen als Knöpfe untereinander; jetzt ein Zeilenmenü wie bei den Rücklagen. */
describe('NoticesTable', () => {
  it('puts the actions of a row into one menu instead of a stack of buttons', () => {
    render(<NoticesTable rows={[row()]} canIssue canPickDocument={false} />, { wrapper: Intl });
    const tableRow = screen.getByTestId('notice-row');
    expect(within(tableRow).getByRole('button', { name: 'Aktionen zu Freistellungsbescheid' })).toBeTruthy();
    expect(within(tableRow).queryByRole('button', { name: 'Irrtümlich erfasst' })).toBeNull();
    expect(within(tableRow).queryByRole('button', { name: 'Dokument nachreichen' })).toBeNull();
  });

  it('shows no menu where nothing is left to do, and none without the permission', () => {
    render(<NoticesTable rows={[row({ id: 'N2', voidedAt: '2026-01-01T00:00:00.000Z', state: 'voided' })]} canIssue canPickDocument={false} />, { wrapper: Intl });
    expect(screen.queryByTestId('notice-menu')).toBeNull();
    cleanup();
    render(<NoticesTable rows={[row()]} canIssue={false} canPickDocument={false} />, { wrapper: Intl });
    expect(screen.queryByTestId('notice-menu')).toBeNull();
  });
});
