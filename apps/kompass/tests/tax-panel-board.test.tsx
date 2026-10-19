// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { DateFormatProvider } from '@/components/date-format-provider';
import { TaxPanel } from '@/app/(shell)/admin/finance/tax-panel';
import { setBoardRemunerationAction } from '@/app/(shell)/admin/finance/actions';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/app/(shell)/admin/finance/actions', () => ({
  setBoardRemunerationAction: vi.fn(async () => ({ status: 'success' })),
  setExpenseWaiverBasisAction: vi.fn(),
  setFinanceLimitAction: vi.fn(),
  confirmSetupStepAction: vi.fn(),
  applyTaxDefaultsAction: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.mocked(setBoardRemunerationAction).mockClear();
});

function renderPanel(board: { allowed: boolean; basisText: string; validFrom: string | null; decidedOn: string | null }) {
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <DateFormatProvider mode="locale" timeZone="Europe/Berlin">
        <TaxPanel
          switches={{ isEntrepreneurOrHasVatId: false, membershipFeesCertifiable: false, expenseWaiversEnabled: false, mcpHumanOnlyAllowed: false }}
          limits={{ statementSufficesBelowCents: 30000, cashDonationAlertCents: 100000, roundAmountFromCents: 50000, proofGraceDays: 30 }}
          confirmedAt={null}
          waiverBasisText=""
          waiverBasisAgreedOn={null}
          boardRemuneration={board}
        />
      </DateFormatProvider>
    </NextIntlClientProvider>,
  );
  return screen.getByTestId('board-remuneration');
}

/** Joe 11.9: Die Vergütung des Vorstands ist eine Ja/Nein-Frage; „Nein“ ist eine Entscheidung, die sich speichern lässt. */
describe('TaxPanel Vergütung des Vorstands', () => {
  it('fragt ohne Vorauswahl, solange nichts entschieden ist, und zeigt Fundstelle und „Gilt ab“ erst bei „Ja“', () => {
    const card = renderPanel({ allowed: false, basisText: '', validFrom: null, decidedOn: null });
    const group = within(card).getByRole('radiogroup', { name: 'Sind Pauschalen an Vorstandsmitglieder vorgesehen?' });
    for (const radio of within(group).getAllByRole('radio')) expect(radio.getAttribute('aria-checked')).toBe('false');
    expect(within(card).queryByLabelText('Satzungsfundstelle')).toBeNull();
    fireEvent.click(within(group).getByRole('radio', { name: 'Ja' }));
    expect(within(card).getByLabelText('Satzungsfundstelle')).toBeTruthy();
    expect(within(card).getByLabelText('Gilt ab')).toBeTruthy();
  });

  it('speichert ein „Nein“ als erste Entscheidung', async () => {
    const card = renderPanel({ allowed: false, basisText: '', validFrom: null, decidedOn: null });
    fireEvent.click(within(card).getByRole('radio', { name: 'Nein' }));
    fireEvent.click(within(card).getByTestId('board-remuneration-save'));
    await waitFor(() => expect(setBoardRemunerationAction).toHaveBeenCalledWith(false, '', null));
  });

  it('zeigt eine getroffene Entscheidung vorgewählt', () => {
    const card = renderPanel({ allowed: false, basisText: '', validFrom: null, decidedOn: '2026-06-15' });
    expect(within(card).getByRole('radio', { name: 'Nein' }).getAttribute('aria-checked')).toBe('true');
  });

  it('steht in derselben Form wie die übrigen Ja/Nein-Fragen: Frage und Ja/Nein in einer Zeile, Hinweis darunter (172)', () => {
    const card = renderPanel({ allowed: false, basisText: '', validFrom: null, decidedOn: null });
    const switchRow = within(screen.getByTestId('tax-switches')).getAllByRole('radiogroup')[0]!.parentElement!.parentElement!;
    const group = within(card).getByRole('radiogroup', { name: 'Sind Pauschalen an Vorstandsmitglieder vorgesehen?' });
    const row = group.parentElement!.parentElement!;
    expect(row.className).toBe(switchRow.className);
    expect(row.textContent).toContain('Sind Pauschalen an Vorstandsmitglieder vorgesehen?');
    expect(row.nextElementSibling?.textContent).toBe(messages.finance.admin.tax.boardRemuneration.hint);
  });

  it('der erste Abschnitt heißt „Einordnung des Vereins“ (172)', () => {
    renderPanel({ allowed: false, basisText: '', validFrom: null, decidedOn: null });
    expect(screen.getByRole('heading', { name: 'Einordnung des Vereins' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Schalter' })).toBeNull();
  });
});
