// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { DateFormatProvider } from '@/components/date-format-provider';
import { CorrectDialog, type CorrectDialogEntry } from '@/app/(shell)/finance/entries/[id]/correct-dialog';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/app/(shell)/finance/entries/actions', () => ({ requestCorrectionAction: vi.fn(), uploadCorrectionProofAction: vi.fn(), reverseEntryAction: vi.fn() }));
vi.mock('@/app/(shell)/finance/donations/actions', () => ({ voidConfirmationAction: vi.fn() }));
vi.mock('@/app/(shell)/contacts/search-action', () => ({ searchContactsAction: vi.fn(async () => []) }));
vi.mock('@/app/(shell)/dms/search-action', () => ({ searchDocumentsAction: vi.fn(async () => []) }));
afterEach(cleanup);

type Line = CorrectDialogEntry['allocationLines'][number];
const line = (id: string, amountCents: number, pendingCorrectionId: string | null = null): Line => ({
  id,
  categoryId: 'cat',
  amountCents,
  contactId: null,
  projectId: null,
  purposeId: null,
  abroad: false,
  pendingCorrectionId,
});

const vatContext = { taxation: 'smallBusiness' as const, rates: { standard: 19, reduced: 7 }, periodKinds: { 2025: 'quarter' as const, 2026: 'quarter' as const, 2027: 'quarter' as const } };

const ALL_CODES = ['none', 'rc13bEu', 'rc13bOther', 'icAcquisition'];

function open(lines: Line[], filedVatPeriods: Record<string, string> = {}, taxCodeOptions: Record<string, string[]> = Object.fromEntries(lines.map((l) => [l.id, ALL_CODES]))) {
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <DateFormatProvider mode="locale" timeZone="Europe/Berlin">
        <CorrectDialog entry={{ id: 'E', entryDate: '2026-07-02', allocationLines: lines }} purposes={[]} projects={[]} contactNames={new Map()} categoryNames={new Map([['cat', 'Spenden']])} filedVatPeriods={filedVatPeriods} vatContext={vatContext} taxCodeOptions={taxCodeOptions} />
      </DateFormatProvider>
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Korrigieren' }));
}

/** Der Korrekturdialog an einer festgeschriebenen Buchung: Auswahl der Aufteilung und Absenden nur mit Änderung. */
describe('CorrectDialog', () => {
  it('eine Aufteilung, deren Änderung auf Freigabe wartet, lässt sich nicht erneut wählen', () => {
    open([line('a', 7000, 'corr-1'), line('b', 3000)]);
    const pendingRow = screen.getByRole('button', { name: /wartet auf Freigabe/ });
    expect(pendingRow).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: /30,00/ })).toHaveProperty('disabled', false);
  });

  it('bei nur einer Aufteilung gibt es keinen Auswahlschritt', () => {
    open([line('a', 3000)]);
    expect(screen.queryByRole('button', { name: /30,00/ })).toBeNull();
    expect(screen.getByRole('checkbox', { name: /im Ausland verwendet/ })).toBeTruthy();
  });

  it('wer nichts ändert, kann nicht absenden', () => {
    open([line('a', 3000)]);
    fireEvent.click(screen.getByRole('checkbox', { name: /im Ausland verwendet/ }));
    fireEvent.change(screen.getByLabelText('Begründung'), { target: { value: 'Testkorrektur ohne Änderung' } });
    const submit = screen.getByRole('button', { name: 'Zuordnung ändern' });
    expect(submit).toHaveProperty('disabled', true);
    // Gegenprobe: mit einer echten Änderung geht es.
    fireEvent.click(screen.getByRole('switch', { name: /im Ausland verwendet/ }));
    expect(submit).toHaveProperty('disabled', false);
  });

  describe('Umsatzsteuer (E6a Task 11c, Board 4a)', () => {
    const c = messages.finance.entryView.correct;
    it('offers the code only on expense lines with an allowed code, with the four values', () => {
      open([line('a', 3000)]);
      expect(screen.queryByRole('checkbox', { name: c.party.vat })).toBeNull();
      cleanup();
      open([{ ...line('a', -5000), taxCode: 'standard', serviceDate: null }]);
      expect(screen.queryByRole('checkbox', { name: c.party.vat })).toBeNull();
      cleanup();
      open([{ ...line('a', -5000), taxCode: 'rc13bEu', serviceDate: null }]);
      fireEvent.click(screen.getByRole('checkbox', { name: c.party.vat }));
      const select = screen.getByLabelText(c.vat.taxCode) as HTMLSelectElement;
      expect([...select.querySelectorAll('option')].map((o) => o.value)).toEqual(['none', 'rc13bEu', 'rc13bOther', 'icAcquisition']);
    });

    /** Plan E15 Task 2 (Befund 40, Frage 2): nur, was der Dienst für die Zeile anbietet (`correctionTaxCodesInternal`). */
    it('offers only the codes the service names for the line', () => {
      open([{ ...line('a', -5000), taxCode: 'none', serviceDate: null }], {}, { a: ['none', 'rc13bOther', 'icAcquisition'] });
      fireEvent.click(screen.getByRole('checkbox', { name: c.party.vat }));
      const select = screen.getByLabelText(c.vat.taxCode) as HTMLSelectElement;
      expect([...select.querySelectorAll('option')].map((o) => o.value)).toEqual(['none', 'rc13bOther', 'icAcquisition']);
    });

    it('warns before a correction into a filed period and keeps the button usable', () => {
      open([{ ...line('a', -5000), taxCode: 'rc13bEu', serviceDate: null }], { '2026-Q2': '2026-07-08' });
      fireEvent.click(screen.getByRole('checkbox', { name: c.party.vat }));
      expect(screen.queryByTestId('correct-vat-filed')).toBeNull();
      fireEvent.change(screen.getByLabelText(messages.finance.splitRow.serviceDate), { target: { value: '2026-06-26' } });
      expect(screen.getByTestId('correct-vat-filed')).toBeTruthy();
      fireEvent.change(screen.getByLabelText('Begründung'), { target: { value: 'Rechnung nennt Juni' } });
      expect(screen.getByRole('button', { name: 'Zuordnung ändern' })).toHaveProperty('disabled', false);
    });
  });
});
