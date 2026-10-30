// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace }), usePathname: () => '/finance/fund-use' }));
vi.mock('@/app/(shell)/finance/reports/actions', () => ({ finalizeReportAction: vi.fn(), releaseYearAction: vi.fn(), uploadAuditReportAction: vi.fn() }));
vi.mock('@/app/(shell)/dms/search-action', () => ({ searchDocumentsAction: vi.fn(async () => []) }));
vi.mock('@/app/(shell)/finance/closing/actions', () => ({ fileStatementAction: vi.fn(), linkStatementAction: vi.fn(), suggestStatementAction: vi.fn(async () => null) }));
const { ReportView } = await import('@/app/(shell)/finance/reports/[key]/report-view');
const { FundsUseNotices } = await import('@/app/(shell)/finance/fund-use/funds-use-notices');
afterEach(cleanup);
beforeEach(() => replace.mockReset());

const m = (path: string) => path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], messages) as string;
type Props = React.ComponentProps<typeof ReportView>;
const base: Props = {
  reportKey: 'fundsUse',
  title: 'Mittelverwendung 2025',
  orientation: 'landscape',
  pageCount: 2,
  back: { href: '/finance/reports?year=y25', label: 'Berichte' },
  stage: 'review',
  shortHash: '7c1e09ab',
  generatedAt: '2026-02-02T13:12:00.000Z',
  finalizeBlock: null,
  warnings: [],
  probeDifferenceCents: null,
  combineAllowed: false,
  params: { fiscalYearId: 'y25' },
  years: [{ id: 'y25', designation: '2025' }, { id: 'y24', designation: '2024' }],
  year: { id: 'y25', designation: '2025' },
  canFinalize: true,
  canRelease: true,
  canOpenVersions: true,
  versions: [],
  group: 'taxOffice',
};
const wrap = (node: React.ReactNode) => render(<NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">{node}</NextIntlClientProvider>);
const description = () => document.querySelector('[data-slot="page-header-title"] p')!.textContent ?? '';

describe('ReportView für die Mittelverwendung (Plan U2 Task 2)', () => {
  it('replaces the purpose sentence with the page’s own head sentence', () => {
    wrap(<ReportView {...base} />);
    const purpose = document.querySelector('[data-slot="page-header-title"] p span')!.textContent!;
    cleanup();
    wrap(<ReportView {...base} purpose={<span data-testid="own-head">Kopfsatz</span>} />);
    expect(screen.getByTestId('own-head')).toBeTruthy();
    expect(description()).not.toContain(purpose);
  });

  it('has no way back when the page hangs in the navigation', () => {
    wrap(<ReportView {...base} back={undefined} />);
    expect(screen.queryByRole('link', { name: /Berichte/ })).toBeNull();
  });

  it('writes the year into the address of its own page', () => {
    wrap(<ReportView {...base} basePath="/finance/fund-use" />);
    fireEvent.change(screen.getByLabelText(m('finance.reports.view.params.year')), { target: { value: 'y24' } });
    expect(replace).toHaveBeenCalledWith('/finance/fund-use?year=y24');
  });

  it('shows its notices and header actions', () => {
    wrap(<ReportView {...base} notices={<p data-testid="own-notices">!</p>} headerActions={<button type="button">⋯</button>} />);
    expect(screen.getByTestId('own-notices')).toBeTruthy();
    expect(screen.getByRole('button', { name: '⋯' })).toBeTruthy();
  });
});

describe('FundsUseNotices', () => {
  const year = { id: 'y25', designation: '2025' };
  it('renders one warning per entry, each with its way', () => {
    wrap(
      <FundsUseNotices
        year={year}
        notices={[
          { kind: 'deadlineMissed', origin: '2023', restCents: 340_000, dueBy: '2025-12-31' },
          { kind: 'loss', sphere: 'business', cents: 125_000 },
          { kind: 'endowmentWithOverhang' },
        ]}
      />,
    );
    expect(screen.getAllByRole('status')).toHaveLength(3);
    expect(screen.getByRole('link', { name: m('finance.fundUse.notices.toDeadlines') }).getAttribute('href')).toBe('/finance/deadlines');
    expect(screen.getByRole('link', { name: m('finance.fundUse.notices.toIncomeStatement') }).getAttribute('href')).toBe('/finance/reports/incomeStatement?year=y25');
  });

  it('renders nothing without notices', () => {
    const { container } = wrap(<FundsUseNotices year={year} notices={[]} />);
    expect(container.textContent).toBe('');
  });
});
