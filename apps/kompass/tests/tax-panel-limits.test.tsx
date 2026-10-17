// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { DateFormatProvider } from '@/components/date-format-provider';
import { TaxPanel } from '@/app/(shell)/admin/finance/tax-panel';
import { applyTaxDefaultsAction, setFinanceLimitsAction, setFinanceSwitchesAction } from '@/app/(shell)/admin/finance/actions';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/app/(shell)/admin/finance/actions', () => ({
  applyTaxDefaultsAction: vi.fn(async () => ({ status: 'success' })),
  setBoardRemunerationAction: vi.fn(),
  setExpenseWaiverBasisAction: vi.fn(),
  setFinanceLimitsAction: vi.fn(async () => ({ status: 'success' })),
  setFinanceSwitchAction: vi.fn(),
  setFinanceSwitchesAction: vi.fn(async () => ({ status: 'success' })),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPanel(confirmedAt: string | null = null) {
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <DateFormatProvider mode="locale" timeZone="Europe/Berlin">
        <TaxPanel
          switches={{ isEntrepreneurOrHasVatId: false, membershipFeesCertifiable: false, expenseWaiversEnabled: false, mcpHumanOnlyAllowed: false }}
          limits={{ statementSufficesBelowCents: 30000, cashDonationAlertCents: 100000, roundAmountFromCents: 50000, proofGraceDays: 30 }}
          confirmedAt={confirmedAt}
          waiverBasisText=""
          waiverBasisAgreedOn={null}
          boardRemuneration={{ allowed: false, basisText: '', validFrom: null, decidedOn: null }}
        />
      </DateFormatProvider>
    </NextIntlClientProvider>,
  );
}

/**
 * Steuerliches (Runde 3, 172; Joe 2026-10-17): je Abschnitt eine Speicherleiste — Schalter eine, Grenzen eine statt vier
 * Knöpfe. Jede Leiste ruft einen Dienst; der Agent-Schalter speichert weiter sofort.
 */
describe('TaxPanel Steuerliches', () => {
  it('die Grenzen haben eine Speicherleiste statt eines Knopfs je Zeile, die Tage stehen im Feld', async () => {
    renderPanel();
    const limits = screen.getByTestId('tax-limits');
    for (const id of ['tax-limit-statement-suffices', 'tax-limit-cash-donation', 'tax-limit-round-amount', 'tax-limit-proof-grace-days']) {
      expect(within(screen.getByTestId(id)).queryAllByRole('button'), id).toHaveLength(0);
    }
    expect(within(screen.getByTestId('tax-limit-proof-grace-days')).getByText('Tage')).toBeTruthy();
    fireEvent.change(within(limits).getByLabelText('Wie viele Tage Kulanz nach der Nachweisfrist einer Zahlung an Partner, bevor sie als überfällig gilt?'), { target: { value: '45' } });
    fireEvent.click(within(limits).getByTestId('tax-limits-save'));
    await waitFor(() => expect(setFinanceLimitsAction).toHaveBeenCalledWith([{ key: 'finance.proofGraceDays', cents: 45 }]));
  });

  it('die Schalter speichern mit einer Leiste, nur was sich geändert hat', async () => {
    renderPanel();
    const switches = screen.getByTestId('tax-switches');
    const group = within(switches).getByRole('radiogroup', { name: 'Sind Mitgliedsbeiträge bescheinigungsfähig?' });
    fireEvent.click(within(group).getByRole('radio', { name: 'Ja' }));
    fireEvent.click(within(switches).getByTestId('tax-switches-save'));
    await waitFor(() => expect(setFinanceSwitchesAction).toHaveBeenCalledWith([{ key: 'finance.membershipFeesCertifiable', value: true }]));
  });

  it('„Vorgaben übernehmen“ steht neben „Noch nicht bestätigt.“, nicht mehr nach der Bestätigung', async () => {
    renderPanel();
    expect(screen.getByText('Noch nicht bestätigt.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Vorgaben übernehmen' }));
    await waitFor(() => expect(applyTaxDefaultsAction).toHaveBeenCalled());
    cleanup();
    renderPanel('2026-06-15T10:00:00.000Z');
    expect(screen.queryByRole('button', { name: 'Vorgaben übernehmen' })).toBeNull();
  });

  it('der Agent-Schalter bleibt ein Schalter, „Gilt ab“ statt „Gilt seit“', () => {
    renderPanel();
    expect(within(screen.getByTestId('mcp-human-only-row')).getByRole('switch', { name: 'Darf ein Agent festschreiben?' })).toBeTruthy();
    expect(JSON.stringify(messages.finance.admin.tax)).not.toContain('Gilt seit');
  });
});
