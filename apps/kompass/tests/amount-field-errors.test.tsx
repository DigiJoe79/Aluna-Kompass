// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatedValuesPanel } from '@/app/(shell)/admin/finance/dated-values-panel';
import { FinanceSectionEditor } from '@/app/(shell)/projects/[id]/finance-section-editor';
import { DateFormatProvider } from '@/components/date-format-provider';
import messages from '../messages/de.json';

const datedActions = vi.hoisted(() => ({ setDatedValueAction: vi.fn(), removeDatedValueAction: vi.fn() }));
vi.mock('@/app/(shell)/admin/finance/actions', () => datedActions);
const projectActions = vi.hoisted(() => ({ setProjectFinanceAction: vi.fn() }));
vi.mock('@/app/(shell)/projects/[id]/finance-actions', () => projectActions);
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

const amountMessages = messages.finance.amount;

describe('Datierte Werte: Betrag ist Pflicht (App-B7c)', () => {
  const entries = [{ key: 'allowanceVolunteer', unit: 'cents' as const, entries: [{ validFrom: '2026-01-01', value: 84000, source: 'shipped' as const }] }];
  const openDialog = () => {
    render(<DatedValuesPanel entries={entries} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: /Ehrenamtspauschale/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: messages.finance.admin.datedValues.change }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(messages.finance.admin.datedValues.validFrom, { exact: false }), { target: { value: '2027-01-01' } });
    return dialog;
  };

  it('leer: Feldfehler „fehlt“, kein Aufruf — keine 0 € ab Stichtag', async () => {
    const dialog = openDialog();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: messages.common.save }));
    });
    expect(datedActions.setDatedValueAction).not.toHaveBeenCalled();
    expect(within(dialog).getByText(amountMessages.missing)).toBeTruthy();
  });

  it('unlesbar: Formatfehler am Feld, kein Aufruf; lesbar geht in Cent an den Dienst', async () => {
    datedActions.setDatedValueAction.mockResolvedValue({ status: 'success' });
    const dialog = openDialog();
    const amount = within(dialog).getByLabelText(messages.finance.admin.datedValues.value, { exact: false });
    fireEvent.change(amount, { target: { value: '12.50' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: messages.common.save }));
    });
    expect(datedActions.setDatedValueAction).not.toHaveBeenCalled();
    expect(within(dialog).getByText(amountMessages.format)).toBeTruthy();
    fireEvent.change(amount, { target: { value: '960,00' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: messages.common.save }));
    });
    expect(datedActions.setDatedValueAction).toHaveBeenCalledWith('allowanceVolunteer', '2027-01-01', 96000);
  });
});

describe('Spendenziel eines Projekts: optional, aber nie still gelöscht (App-B6)', () => {
  const initial = { targetCents: 500000, defaultPurposeId: null, abroad: false, publishDonationStatus: false };

  it('unlesbar: Formatfehler am Feld, kein Aufruf; leer löscht das Ziel', async () => {
    projectActions.setProjectFinanceAction.mockResolvedValue({ status: 'success' });
    render(<FinanceSectionEditor projectId="P1" initial={initial} purposes={[]} />, { wrapper });
    fireEvent.click(screen.getByRole('button'));
    const dialog = screen.getByRole('dialog');
    const target = within(dialog).getByLabelText(messages.finance.projectSection.dialog.target, { exact: false });
    fireEvent.change(target, { target: { value: 'fünftausend' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: messages.finance.projectSection.dialog.save }));
    });
    expect(projectActions.setProjectFinanceAction).not.toHaveBeenCalled();
    expect(within(dialog).getByText(amountMessages.format)).toBeTruthy();
    fireEvent.change(target, { target: { value: '' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: messages.finance.projectSection.dialog.save }));
    });
    expect(projectActions.setProjectFinanceAction).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'P1', targetCents: null }));
  });
});
