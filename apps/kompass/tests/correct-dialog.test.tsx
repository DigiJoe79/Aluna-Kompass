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

function open(lines: Line[]) {
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <DateFormatProvider mode="locale" timeZone="Europe/Berlin">
        <CorrectDialog entry={{ id: 'E', allocationLines: lines }} purposes={[]} projects={[]} contactNames={new Map()} categoryNames={new Map([['cat', 'Spenden']])} />
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
});
