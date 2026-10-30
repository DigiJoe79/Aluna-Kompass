// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

const finalizeReportAction = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/app/(shell)/finance/reports/actions', () => ({ finalizeReportAction }));
const { FinalizeDialog } = await import('@/app/(shell)/finance/reports/[key]/finalize-dialog');
afterEach(cleanup);
beforeEach(() => finalizeReportAction.mockReset());

const m = (path: string) => path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], messages) as string;
const params = { fiscalYearId: 'y25' };
const show = (consequences?: { explanationMissing: boolean; remunerationWithoutBasis: number }) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <FinalizeDialog open onOpenChange={vi.fn()} reportKey="annualAccounts" params={params} shortHash="7d3e91ab" title="Jahresrechnung 2025" consequences={consequences} />
    </NextIntlClientProvider>,
  );
const dlg = () => screen.queryByRole('dialog') ?? screen.getByRole('alertdialog');
const FINALIZE = () => within(dlg()).getByRole('button', { name: m('finance.reports.view.finalize') });
const describedBy = (el: Element) => (el.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ');

describe('Festschreiben mit Folgen (Designer Frage 1, Planreview J1)', () => {
  it('without consequences the confirmation stays as it was and sends no confirmation', async () => {
    finalizeReportAction.mockResolvedValue({ status: 'success' });
    show();
    expect(within(dlg()).queryByRole('listitem')).toBeNull();
    fireEvent.click(FINALIZE());
    await waitFor(() => expect(finalizeReportAction).toHaveBeenCalledWith('annualAccounts', params));
  });

  it('a missing explanation is named as consequence and does not block', async () => {
    finalizeReportAction.mockResolvedValue({ status: 'success' });
    show({ explanationMissing: true, remunerationWithoutBasis: 0 });
    expect(within(dlg()).getAllByRole('listitem')).toHaveLength(1);
    expect(within(dlg()).queryByRole('radiogroup')).toBeNull();
    fireEvent.click(FINALIZE());
    await waitFor(() => expect(finalizeReportAction).toHaveBeenCalledWith('annualAccounts', params));
  });

  it('payments without basis: without a reason the refusal of the service stands at the reason', async () => {
    finalizeReportAction.mockResolvedValue({ status: 'error', code: 'annualAccountsRemunerationWithoutBasis', message: 'An 2 Vorstandsmitglied(er) …', fieldErrors: {} });
    show({ explanationMissing: false, remunerationWithoutBasis: 2 });
    const group = within(dlg()).getByRole('radiogroup');
    fireEvent.click(FINALIZE());
    await waitFor(() => expect(finalizeReportAction).toHaveBeenCalledWith('annualAccounts', params, undefined));
    await waitFor(() => expect(describedBy(group)).toContain('An 2 Vorstandsmitglied(er)'));
  });

  it('“other” needs a text: the field error of the service stands at the note', async () => {
    finalizeReportAction.mockResolvedValue({ status: 'error', message: 'Nicht gespeichert', fieldErrors: { 'confirmation.note': 'Bitte ausfüllen.' } });
    show({ explanationMissing: false, remunerationWithoutBasis: 2 });
    fireEvent.click(within(dlg()).getByRole('radio', { name: m('finance.reports.view.confirm.reasons.other') }));
    const note = await within(dlg()).findByRole('textbox');
    fireEvent.click(FINALIZE());
    await waitFor(() => expect(finalizeReportAction).toHaveBeenCalledWith('annualAccounts', params, { reason: 'other', note: null }));
    await waitFor(() => expect(note.getAttribute('aria-invalid')).toBe('true'));
  });

  it('with “recovery initiated” the action gets the reason', async () => {
    finalizeReportAction.mockResolvedValue({ status: 'success' });
    show({ explanationMissing: true, remunerationWithoutBasis: 1 });
    expect(within(dlg()).getAllByRole('listitem')).toHaveLength(2);
    fireEvent.click(within(dlg()).getByRole('radio', { name: m('finance.reports.view.confirm.reasons.recoveryInitiated') }));
    fireEvent.click(FINALIZE());
    await waitFor(() => expect(finalizeReportAction).toHaveBeenCalledWith('annualAccounts', params, { reason: 'recoveryInitiated', note: null }));
  });
});
