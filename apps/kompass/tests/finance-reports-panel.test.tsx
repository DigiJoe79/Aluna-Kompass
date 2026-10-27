// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

const setReportSettingsAction = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/(shell)/admin/finance/actions', () => ({ setReportSettingsAction }));
const { ReportsPanel } = await import('@/app/(shell)/admin/finance/reports-panel');
afterEach(cleanup);

const m = (path: string) => path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], messages) as string;
const panel = () =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <ReportsPanel values={{ statuteReference: '', cashReportSignature: false, treasurerIsStatutoryBoard: null }} />
    </NextIntlClientProvider>,
  );

describe('ReportsPanel (Plan A3 Task 6b)', () => {
  it('saves both settings with the form, the switch right of its text', async () => {
    setReportSettingsAction.mockResolvedValue({ status: 'success', message: 'ok' });
    panel();
    fireEvent.change(screen.getByLabelText(m('finance.admin.reports.statuteReference')), { target: { value: '§ 9 Nr. 3 der Satzung' } });
    const toggle = screen.getByRole('switch', { name: m('finance.admin.reports.cashReportSignature') });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByTestId('reports-settings-save'));
    await waitFor(() => expect(setReportSettingsAction).toHaveBeenCalledWith({ statuteReference: '§ 9 Nr. 3 der Satzung', cashReportSignature: true, treasurerIsStatutoryBoard: null }));
  });

  it('Satzungsangabe § 26 BGB (Amtsübergabe): Ja · Nein · Keine Angabe, Vorgabe ohne Angabe', async () => {
    setReportSettingsAction.mockResolvedValue({ status: 'success' });
    panel();
    const board = screen.getByTestId('reports-board');
    expect(screen.getByRole('radio', { name: m('finance.admin.reports.board.unknown') }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: m('finance.admin.reports.board.yes') }));
    expect(board).toBeTruthy();
    fireEvent.click(screen.getByTestId('reports-settings-save'));
    await waitFor(() => expect(setReportSettingsAction).toHaveBeenCalledWith(expect.objectContaining({ treasurerIsStatutoryBoard: true })));
  });

  it('puts the field error at the field', async () => {
    setReportSettingsAction.mockResolvedValue({ status: 'error', message: 'x', fieldErrors: { statuteReference: 'Höchstens 80 Zeichen.' } });
    panel();
    fireEvent.change(screen.getByLabelText(m('finance.admin.reports.statuteReference')), { target: { value: 'x' } });
    fireEvent.click(screen.getByTestId('reports-settings-save'));
    expect(await screen.findByText('Höchstens 80 Zeichen.')).toBeTruthy();
  });
});
