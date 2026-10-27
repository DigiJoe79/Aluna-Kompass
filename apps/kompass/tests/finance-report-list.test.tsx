// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }), usePathname: () => '/finance/reports', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/app/(shell)/finance/reports/actions', () => ({ releaseYearAction: vi.fn(), uploadAuditReportAction: vi.fn() }));
vi.mock('@/app/(shell)/dms/search-action', () => ({ searchDocumentsAction: vi.fn(async () => []) }));
const { ReportList, reportRowHref } = await import('@/app/(shell)/finance/reports/report-list');
const { ReportsHeader } = await import('@/app/(shell)/finance/reports/reports-header');
afterEach(cleanup);

const m = (path: string) => path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], messages) as string;
const wrap = (node: React.ReactNode) => render(<NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">{node}</NextIntlClientProvider>);

const rows = [
  { key: 'incomeStatement', group: 'taxOffice' as const, available: true, finalLabel: '21.02.2026 · Anna Berger' },
  { key: 'cashReport', group: 'assembly' as const, available: true, finalLabel: null },
  { key: 'accountReconciliation', group: 'audit' as const, available: true, finalLabel: null },
  { key: 'fundsUse', group: 'taxOffice' as const, available: false, finalLabel: null },
];
const years = [{ id: 'y25', designation: '2025' }, { id: 'y26', designation: '2026' }];

describe('ReportList (Board 2a)', () => {
  it('groups in the order of the year, leaves empty groups out, links each report with the year', () => {
    wrap(<ReportList rows={rows} years={years} yearId="y25" />);
    const groups = screen.getAllByTestId('report-group').map((g) => g.textContent);
    expect(groups).toEqual([m('finance.reports.groups.assembly'), m('finance.reports.groups.audit'), m('finance.reports.groups.taxOffice')]);
    const link = screen.getByRole('link', { name: m('finance.reports.cashReport.title') });
    expect(link.getAttribute('href')).toBe('/finance/reports/cashReport?year=y25');
  });

  it('links the tax reports by the period of the year, the Anlage Gem to the tax return page (15i)', () => {
    expect(reportRowHref({ key: 'taxReturnGem', periodId: 'p1' }, 'y25')).toBe('/finance/tax?period=p1');
    expect(reportRowHref({ key: 'taxReturnIncomeStatement', periodId: 'p1' }, 'y25')).toBe('/finance/reports/taxReturnIncomeStatement?period=p1');
    expect(reportRowHref({ key: 'taxReturnIncomeStatement', periodId: null }, 'y25')).toBe('/finance/tax');
    expect(reportRowHref({ key: 'handoverList' }, 'y25')).toBe('/finance/reports/handoverList');
    expect(reportRowHref({ key: 'cashReport' }, 'y25')).toBe('/finance/reports/cashReport?year=y25');
  });

  it('shows the newest final version as text, no stage mark, no row actions', () => {
    wrap(<ReportList rows={rows} years={years} yearId="y25" />);
    const row = screen.getByRole('link', { name: m('finance.reports.incomeStatement.title') }).closest('tr')!;
    expect(row.textContent).toContain('21.02.2026 · Anna Berger');
    expect(within(row).queryByRole('button')).toBeNull();
    // Keine Marke der Stufe; „festgeschrieben“ steht nur als Wort vor dem Datum, für das Telefon ohne Spaltenkopf (239).
    const badges = [...document.querySelectorAll('table [data-slot="status-badge"]')].map((b) => b.textContent);
    for (const stage of ['preliminary', 'review', 'final']) expect(badges).not.toContain(m(`finance.reports.stage.${stage}`));
  });

  it('greys out the fund use report without a link', () => {
    wrap(<ReportList rows={rows} years={years} yearId="y25" />);
    expect(screen.queryByRole('link', { name: new RegExp(m('finance.reports.fundsUse.title')) })).toBeNull();
    const muted = document.querySelector('tr[data-muted]')!;
    expect(muted.textContent).toContain(m('finance.reports.fundsUse.title'));
    expect(muted.textContent).toContain(m('common.muted.later'));
  });

  it('counts the reports in the frame of the year', () => {
    wrap(<ReportList rows={rows} years={years} yearId="y25" />);
    expect(screen.getByTestId('reports-year').textContent).toContain('4');
  });
});

const header = (over: Partial<React.ComponentProps<typeof ReportsHeader>> = {}) => (
  <ReportsHeader year={{ id: 'y25', designation: '2025', status: 'closed' }} release={null} releaseChangeable assembly={{ done: 0, total: 2 }} canRelease {...over} />
);
const releaseButton = () => screen.queryByRole('button', { name: m('finance.reports.release.open') });
const moreButton = () => screen.queryByRole('button', { name: m('common.moreActions') });

describe('ReportsHeader (Board 11a)', () => {
  it('laufendes Jahr (292): vorläufig, ohne Link in den Jahresabschluss; beendet und offen mit Link', () => {
    wrap(header({ year: { id: 'y26', designation: '2026', status: 'open' }, ended: false, closingLink: true }));
    expect(screen.queryByTestId('reports-to-close')).toBeNull();
    cleanup();
    wrap(header({ year: { id: 'y25', designation: '2025', status: 'open' }, ended: true, closingLink: true }));
    expect(screen.getByTestId('reports-to-close')).toBeTruthy();
  });

  it('open year: only the sentence', () => {
    wrap(header({ year: { id: 'y26', designation: '2026', status: 'open' } }));
    expect(releaseButton()).toBeNull();
    expect(moreButton()).toBeNull();
  });

  it('closed, not released: primary „Freigeben …“, without the right a sentence instead', () => {
    wrap(header());
    expect(releaseButton()).not.toBeNull();
    cleanup();
    wrap(header({ canRelease: false }));
    expect(releaseButton()).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).parentElement!.parentElement!.textContent).toContain(m('finance.reports.header.releaseNeedsRight'));
  });

  it('released, nothing final: ⋯ „Freigabe ändern …“ only with the right', () => {
    const release = { basis: 'oralReport' as const, at: '2026-02-20T10:00:00.000Z', byName: 'Anna Berger' };
    wrap(header({ release }));
    expect(releaseButton()).toBeNull();
    expect(moreButton()).not.toBeNull();
    expect(document.body.textContent).toContain('Anna Berger');
    cleanup();
    wrap(header({ release, canRelease: false }));
    expect(moreButton()).toBeNull();
  });

  it('Hemmnisse in fester Folge (Runde 4, 2.1): offen → Link auf Schritt 8; nicht freigegeben → erst die Freigabe; freigegeben mit fehlendem Auszug → Link auf Schritt 1', () => {
    const missing = [{ accountId: 'z', name: 'Zweitbank' }];
    wrap(header({ year: { id: 'y25', designation: '2025', status: 'open' }, statementsMissing: missing, endsOn: '2025-12-31', closingLink: true }));
    expect(screen.getByTestId('reports-to-close').getAttribute('href')).toBe('/finance/closing?year=y25#step-close');
    expect(screen.queryByTestId('reports-to-statements')).toBeNull();
    cleanup();
    wrap(header({ statementsMissing: missing, endsOn: '2025-12-31', closingLink: true }));
    expect(releaseButton()).not.toBeNull();
    expect(screen.queryByTestId('reports-statements-missing')).toBeNull();
    cleanup();
    wrap(header({ release: { basis: 'auditReport', at: '2026-02-18T10:00:00.000Z', byName: 'Anna Berger' }, statementsMissing: missing, endsOn: '2025-12-31', closingLink: true }));
    expect(screen.getByTestId('reports-statements-missing').textContent).toContain('Zweitbank');
    expect(screen.getByTestId('reports-to-statements').getAttribute('href')).toBe('/finance/closing?year=y25#step-statements');
    cleanup();
    wrap(header({ release: { basis: 'auditReport', at: '2026-02-18T10:00:00.000Z', byName: 'Anna Berger' }, statementsMissing: [...missing, { accountId: 'y', name: 'Drittbank' }], endsOn: '2025-12-31' }));
    expect(screen.getByTestId('reports-statements-missing').textContent).toContain('2');
    expect(screen.queryByTestId('reports-to-statements')).toBeNull();
  });

  it('offene Nachprüfung (279 Telefon): kein „Freigeben …“, der Satz verweist auf Schritt 10', () => {
    wrap(header({ followUp: 'unchanged', closingLink: true }));
    expect(releaseButton()).toBeNull();
    expect(screen.getByTestId('reports-to-auditReport').getAttribute('href')).toBe('/finance/closing?year=y25#step-auditReport');
  });

  it('after the first final report: no handle any more', () => {
    wrap(header({ release: { basis: 'oralReport', at: '2026-02-20T10:00:00.000Z', byName: 'Anna Berger' }, releaseChangeable: false, assembly: { done: 1, total: 2 } }));
    expect(releaseButton()).toBeNull();
    expect(moreButton()).toBeNull();
  });
});
