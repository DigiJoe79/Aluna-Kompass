// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { DateFormatProvider } from '@/components/date-format-provider';
import { TaxPanel } from '@/app/(shell)/admin/finance/tax-panel';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/app/(shell)/admin/finance/actions', () => ({ setBoardRemunerationAction: vi.fn(), setExpenseWaiverBasisAction: vi.fn(), setFinanceLimitAction: vi.fn(), setFinanceSwitchAction: vi.fn() }));
afterEach(cleanup);

/**
 * Steuerliches (11-1 A2, Joe 2026-10-16): Jede Grenze speichert für sich (eigener Dienstaufruf, eigener
 * Protokolleintrag), ihr Knopf ist aber `outline` statt primär — fünf Hauptknöpfe auf einer Seite wären zu laut.
 */
describe('TaxPanel Grenzen', () => {
  it('die Speichern-Knöpfe der Grenzen sind outline, je Grenze einer', () => {
    render(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <DateFormatProvider mode="locale" timeZone="Europe/Berlin">
          <TaxPanel
            switches={{ isEntrepreneurOrHasVatId: false, membershipFeesCertifiable: false, expenseWaiversEnabled: false, mcpHumanOnlyAllowed: false }}
            limits={{ statementSufficesBelowCents: 30000, cashDonationAlertCents: 100000, roundAmountFromCents: 50000, proofGraceDays: 30 }}
            confirmedAt={null}
            waiverBasisText=""
            waiverBasisAgreedOn={null}
            boardRemunerationAllowed={false}
            boardRemunerationBasisText=""
            boardRemunerationValidFrom={null}
          />
        </DateFormatProvider>
      </NextIntlClientProvider>,
    );
    for (const id of ['tax-limit-statement-suffices', 'tax-limit-cash-donation', 'tax-limit-round-amount', 'tax-limit-proof-grace-days']) {
      const buttons = within(screen.getByTestId(id)).getAllByRole('button');
      expect(buttons).toHaveLength(1);
      expect(buttons[0]!.className, id).toContain('border-line-strong');
      expect(buttons[0]!.className, id).not.toContain('bg-brand');
    }
  });
});
