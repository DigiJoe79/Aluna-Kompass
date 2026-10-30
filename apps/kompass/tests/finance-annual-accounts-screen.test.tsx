// @vitest-environment jsdom
import type { AnnualAccounts } from '@kompass/module-finance';
import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import messages from '../messages/de.json';
import { formatEuro } from '@/lib/finance/amount';
import { formatPercent } from '@kompass/module-finance/format';

const { AnnualAccountsNotices } = await import('@/app/(shell)/finance/reports/[key]/annual-accounts/screen-notices');
const { ControlValues } = await import('@/app/(shell)/finance/reports/[key]/annual-accounts/control-values');
afterEach(cleanup);

const m = (path: string) => path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], messages) as string;
const wrap = (node: React.ReactNode) => render(<NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">{node}</NextIntlClientProvider>);

type Screen = AnnualAccounts['screen'];
const findings: Screen = {
  over25: [{ section: 'income', key: 'other', sharePermille: 310 }],
  operationsLoss: ['business'],
  aeaoCostRatio: { costsCents: 13200, revenueCents: 71700, permille: 184 },
  gemReconciliation: { incomeCents: 71700, assetSalesCents: 0, taxRefundsCents: 0, gemLine9Cents: 70000, differenceCents: 1700 },
};
const quiet: Screen = { ...findings, over25: [], operationsLoss: [], gemReconciliation: { ...findings.gemReconciliation, gemLine9Cents: 71700, differenceCents: 0 } };
const labels = { other: 'Sonstiges' };
const year = { id: 'y25', designation: '2025' };

describe('Jahresrechnung am Bildschirm: Hinweise und „Zur Kontrolle“ (Abnahme 9)', () => {
  it('warns only about items over 25 % and operation losses', () => {
    wrap(
      <>
        <div data-testid="notices">
          <AnnualAccountsNotices screen={findings} labels={labels} fiscalYearId="y25" />
        </div>
        <ControlValues screen={findings} remunerationWithoutBasis={0} year={year} />
      </>,
    );
    const notices = within(screen.getByTestId('notices')).getAllByRole('status');
    expect(notices).toHaveLength(2);
    expect(notices[0]!.textContent).toContain('Sonstiges');
    expect(notices[0]!.textContent).toContain(formatPercent(310));
    expect(within(notices[0]!).getByRole('link', { name: m('finance.reports.annualAccounts.toCategories') }).getAttribute('href')).toBe('/admin/finance?panel=categories');
    expect(within(notices[1]!).getByRole('link', { name: m('finance.reports.annualAccounts.toIncomeStatement') }).getAttribute('href')).toBe('/finance/reports/incomeStatement?year=y25');
    // Kostenquote und Überleitung stehen in der Wertliste, nie in einem Hinweis.
    const control = screen.getByRole('heading', { name: m('finance.reports.annualAccounts.control.title') }).closest('section')!;
    const list = control.querySelector('dl')!;
    expect(list.textContent).toContain(formatPercent(184));
    expect(list.textContent).toContain(formatEuro(1700));
    for (const n of notices) {
      expect(n.textContent).not.toContain(formatPercent(184));
      expect(n.textContent).not.toContain(formatEuro(1700));
    }
  });

  it('no notice without findings', () => {
    const { container } = wrap(<AnnualAccountsNotices screen={quiet} labels={labels} fiscalYearId="y25" />);
    expect(container.textContent).toBe('');
  });

  it('reconciliation: matches in success, otherwise the difference in warning', () => {
    wrap(<ControlValues screen={quiet} remunerationWithoutBasis={0} year={year} />);
    const ok = document.querySelector('[data-slot="status-badge"]')!;
    expect(ok.getAttribute('data-tone')).toBe('success');
    expect(screen.getByRole('link', { name: m('finance.reports.annualAccounts.control.toTaxReturn').replace('{year}', '2025') }).getAttribute('href')).toBe('/finance/tax');
    cleanup();
    wrap(<ControlValues screen={findings} remunerationWithoutBasis={0} year={year} />);
    const diff = document.querySelector('[data-slot="status-badge"]')!;
    expect(diff.getAttribute('data-tone')).toBe('warning');
    expect(diff.textContent).toContain(formatEuro(1700));
  });

  it('without a cost ratio the value is empty', () => {
    wrap(<ControlValues screen={{ ...quiet, aeaoCostRatio: { costsCents: 0, revenueCents: 0, permille: null } }} remunerationWithoutBasis={0} year={year} />);
    expect(document.querySelector('dl [data-empty]')).not.toBeNull();
  });

  it('remuneration row only when there are payments without basis', () => {
    wrap(<ControlValues screen={quiet} remunerationWithoutBasis={0} year={year} />);
    expect(screen.queryByText(m('finance.reports.annualAccounts.control.remuneration'))).toBeNull();
    cleanup();
    wrap(<ControlValues screen={quiet} remunerationWithoutBasis={2} year={year} />);
    expect(screen.getByText(m('finance.reports.annualAccounts.control.remuneration'))).toBeTruthy();
    const badges = [...document.querySelectorAll('[data-slot="status-badge"]')];
    expect(badges.some((b) => b.getAttribute('data-tone') === 'warning' && b.textContent!.includes('2'))).toBe(true);
    expect(screen.getByRole('link', { name: /2 Zahlungen/ }).getAttribute('href')).toBe('/finance/people');
  });
});
