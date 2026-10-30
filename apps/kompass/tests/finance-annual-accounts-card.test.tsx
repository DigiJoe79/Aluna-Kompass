// @vitest-environment jsdom
import type { AnnualAccountsState } from '@kompass/module-finance';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { formatEuro } from '@/lib/finance/amount';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }), usePathname: () => '/finance/reports/annualAccounts' }));
vi.mock('@/app/(shell)/finance/reports/actions', () => ({ finalizeReportAction: vi.fn(), releaseYearAction: vi.fn(), uploadAuditReportAction: vi.fn() }));
vi.mock('@/app/(shell)/finance/reports/[key]/annual-accounts/actions', () => ({ saveAnnualAccountsExplanationAction: vi.fn() }));
vi.mock('@/components/markdown-preview', () => ({ MarkdownPreview: () => null }));
vi.mock('@/app/(shell)/dms/search-action', () => ({ searchDocumentsAction: vi.fn(async () => []) }));
vi.mock('@/app/(shell)/finance/closing/actions', () => ({ fileStatementAction: vi.fn(), linkStatementAction: vi.fn(), suggestStatementAction: vi.fn(async () => null) }));
const { ReportView } = await import('@/app/(shell)/finance/reports/[key]/report-view');
const { PublicationCard } = await import('@/app/(shell)/finance/reports/[key]/annual-accounts/publication-card');
const { AtAGlance } = await import('@/app/(shell)/finance/reports/[key]/annual-accounts/at-a-glance');
afterEach(cleanup);

const m = (path: string) => path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], messages) as string;
const wrap = (node: React.ReactNode) => render(<NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">{node}</NextIntlClientProvider>);

type Props = React.ComponentProps<typeof ReportView>;
const base: Props = {
  reportKey: 'cashReport',
  title: 'Kassenbericht 2025',
  orientation: 'portrait',
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
  years: [{ id: 'y25', designation: '2025' }],
  year: { id: 'y25', designation: '2025' },
  canFinalize: true,
  canRelease: true,
  canOpenVersions: true,
  versions: [],
  group: 'assembly',
};
const state: AnnualAccountsState = {
  fiscalYearId: 'y25',
  designation: '2025',
  finalVersion: null,
  explanation: { state: 'open', length: 0, updatedAt: null, locked: false },
  signature: { state: 'muted', mutedReason: 'notFinal', signed: null, request: null, canSignSelf: false, representatives: [] },
  website: { state: 'muted', mutedReason: 'notFinal', publication: null, previous: null, publishNeeds: 'nothing', blockedCode: null, mayPublish: true, assemblyOn: null },
  doneCount: 0,
};
const glance = { incomeCents: 71700, expenseCents: 26850, resultCents: 44850, netAssetsCents: 251250, programCentsPerEuro: 80 };
const cardHeading = () => screen.queryByRole('heading', { name: m('finance.reports.annualAccounts.card.title') });

describe('Karte an der Jahresrechnung (Abnahme 1, 13)', () => {
  it('only the annual accounts carry the card, and it stands before the pages', () => {
    wrap(<ReportView {...base} />);
    expect(cardHeading()).toBeNull();
    cleanup();
    wrap(
      <ReportView
        {...base}
        reportKey="annualAccounts"
        title="Jahresrechnung 2025"
        group="public"
        annualAccounts={{ notices: null, card: <PublicationCard state={state} me={{ userId: "u1", canFinalize: true, canPublish: true }} names={{}} explanation={{ text: "", updatedAt: null }} organizationName="Musterverein e.V." today="2026-02-27" />, glance: null, control: null }}
      />,
    );
    const heading = cardHeading()!;
    const pdf = screen.getAllByRole('link').find((a) => a.getAttribute('href')?.includes('/preview'))!;
    expect(heading.compareDocumentPosition(pdf) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const card = screen.getByTestId('annual-accounts-card');
    expect(within(card).getAllByRole('listitem').map((li) => li.dataset.testid)).toEqual(['requirement-explanation', 'requirement-signature', 'requirement-website']);
    // Vor dem Festschreiben: nur „Schreiben …“, gedämpfte Zeilen ohne Knopf (Abnahme 2).
    expect(within(card).getAllByRole('button').map((b) => b.textContent)).toEqual([m('finance.reports.annualAccounts.card.actions.write')]);
    // „Schreiben …“ öffnet die Erläuterung zum Bearbeiten (Task 3).
    fireEvent.click(within(card).getByRole('button', { name: m('finance.reports.annualAccounts.card.actions.write') }));
    expect(within(screen.getByRole('dialog')).getByRole('textbox')).toBeTruthy();
  });

  it('at a glance shows the four values of F1 with the end of the year', () => {
    wrap(<AtAGlance glance={glance} endsOn="2025-12-31" />);
    const list = screen.getByTestId('annual-accounts-glance').querySelector('dl')!;
    const values = [...list.querySelectorAll('dd')].map((d) => d.textContent);
    expect(values).toEqual([formatEuro(71700), formatEuro(26850), formatEuro(44850), formatEuro(251250)]);
    expect(list.textContent).toContain('31.12.2025');
  });
});
