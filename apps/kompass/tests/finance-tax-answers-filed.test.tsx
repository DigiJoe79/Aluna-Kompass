// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { DateFormatProvider } from '@/components/date-format-provider';

const saveTaxPeriodAnswersAction = vi.fn(async (_input: unknown) => ({ status: 'success' as const, message: 'ok' }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/app/(shell)/finance/tax/actions', () => ({ saveTaxPeriodAnswersAction: (input: unknown) => saveTaxPeriodAnswersAction(input), linkTaxPeriodDocumentAction: vi.fn() }));
const { AnswersCard } = await import('@/app/(shell)/finance/tax/answers-card');
afterEach(() => {
  cleanup();
  saveTaxPeriodAnswersAction.mockClear();
});

const years = [{ id: 'y25', designation: '2025', startsOn: '2025-01-01', endsOn: '2025-12-31' }];
const statute = { date: '2026-09-05', documentId: 'DOC-S', source: { label: 'Satzung vom 05.09.2026', href: '/governance/statutes/S1' } };
const show = (filed: boolean) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <DateFormatProvider mode="locale" timeZone="Europe/Berlin">
        <AnswersCard period={{ id: 'p1', version: 'v1', answers: {} }} formYear={2025} years={years} replacementReserves={[]} participationReserves={[]} memberSuggestions={null} canEdit filed={filed} statuteSuggestion={statute} statuteLinked />
      </DateFormatProvider>
    </NextIntlClientProvider>,
  );
const change = () => fireEvent.click(within(screen.getByTestId('answer-statuteDate-source')).getByRole('button'));

/** B9 (F1): Nach der Abgabe bleiben die Angaben änderbar; vor dem Speichern fragt die Seite nach und schickt die Bestätigung mit. */
describe('AnswersCard nach der Abgabe', () => {
  it('asks before saving and sends acknowledgeFiled only after the confirmation', async () => {
    show(true);
    change();
    fireEvent.click(screen.getByTestId('tax-answers-save'));
    const dialog = await screen.findByRole('alertdialog');
    expect(saveTaxPeriodAnswersAction).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: messages.finance.tax.answers.filedConfirm.confirm }));
    await waitFor(() => expect(saveTaxPeriodAnswersAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', acknowledgeFiled: true })));
  });

  it('saves before the filing without asking', async () => {
    show(false);
    change();
    fireEvent.click(screen.getByTestId('tax-answers-save'));
    await waitFor(() => expect(saveTaxPeriodAnswersAction).toHaveBeenCalledWith(expect.not.objectContaining({ acknowledgeFiled: true })));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
