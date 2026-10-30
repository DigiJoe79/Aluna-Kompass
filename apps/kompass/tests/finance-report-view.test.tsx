// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

const finalizeReportAction = vi.fn();
const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace }), usePathname: () => '/finance/reports/cashReport' }));
vi.mock('@/app/(shell)/finance/reports/actions', () => ({ finalizeReportAction, releaseYearAction: vi.fn(), uploadAuditReportAction: vi.fn() }));
vi.mock('@/app/(shell)/dms/search-action', () => ({ searchDocumentsAction: vi.fn(async () => []) }));
vi.mock('@/app/(shell)/finance/closing/actions', () => ({ fileStatementAction: vi.fn(), linkStatementAction: vi.fn(), suggestStatementAction: vi.fn(async () => null) }));
const { ReportView } = await import('@/app/(shell)/finance/reports/[key]/report-view');
afterEach(cleanup);
beforeEach(() => {
  finalizeReportAction.mockReset();
  replace.mockReset();
});

const m = (path: string) => path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], messages) as string;
type Props = React.ComponentProps<typeof ReportView>;
const base: Props = {
  reportKey: 'cashReport',
  title: 'Kassenbericht 2025',
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
  group: 'assembly',
};
const view = (over: Partial<Props> = {}) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <ReportView {...base} {...over} />
    </NextIntlClientProvider>,
  );
const button = (name: string) => screen.queryByRole('button', { name });
const FINALIZE = () => m('finance.reports.view.finalize');
const RELEASE = () => m('finance.reports.release.open');

describe('ReportView: Kopf (Board 2b, 11c)', () => {
  it('shows the stage once next to the title and the hash in the key line', () => {
    view();
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).toBe('Kassenbericht 2025');
    expect(h1.parentElement!.textContent).toContain(m('finance.reports.stage.review'));
    expect(document.querySelector('.font-mono')!.textContent).toContain('7c1e09ab');
  });

  it('chooses the handle from the block: release, none, finalize, locked with reason', () => {
    view({ finalizeBlock: { code: 'reportNotReleased', params: { designation: '2025' } } });
    expect(button(RELEASE())).not.toBeNull();
    expect(button(FINALIZE())).toBeNull();
    cleanup();
    view({ finalizeBlock: { code: 'reportNotReleased', params: { designation: '2025' } }, canRelease: false });
    expect(button(RELEASE())).toBeNull();
    cleanup();
    view({ stage: 'preliminary', finalizeBlock: { code: 'reportYearOpen', params: { designation: '2025' } } });
    expect(button(RELEASE())).toBeNull();
    expect(button(FINALIZE())).toBeNull();
    cleanup();
    view();
    expect((button(FINALIZE()) as HTMLButtonElement).disabled).toBe(false);
    cleanup();
    view({ finalizeBlock: { code: 'reportProbeFails', params: { differenceCents: 1200 } }, probeDifferenceCents: 1200 });
    expect((button(FINALIZE()) as HTMLButtonElement).disabled).toBe(true);
    expect(document.body.textContent).toContain(m('finance.reports.view.blocked.reportProbeFails'));
    cleanup();
    view({ stage: 'final', finalizeBlock: { code: 'reportAlreadyFinal', params: { documentNumber: 'FBR-2026-0001' } } });
    expect(button(FINALIZE())).toBeNull();
    cleanup();
    view({ canFinalize: false });
    expect(button(FINALIZE())).toBeNull();
    cleanup();
    // Arbeitsliste (Joe 2026-10-25): kein Knopf, kein Satz zur Sperre — nur „Herunterladen“.
    view({ reportKey: 'monthlyOverview', group: 'work', stage: 'preliminary', finalizeBlock: { code: 'reportNotFinalizable', params: {} }, finalizable: false });
    expect(button(FINALIZE())).toBeNull();
    expect(button(RELEASE())).toBeNull();
    expect(document.body.textContent).toContain(m('finance.reports.groups.work').replace('Arbeit', 'laufende Arbeit'));
    expect(document.body.textContent).not.toContain('Arbeitsliste');
  });

  it('Auszug fehlt (13c): ein Konto mit Recht → „Auszug ablegen …“ mit dem Dialog; mehrere oder ohne Recht → Link auf Schritt 1; offenes Jahr → Link auf Schritt 8', async () => {
    const one = { code: 'reportStatementsMissing' as const, params: { designation: '2025', accounts: 'Zweitbank', count: 1 } };
    view({ finalizeBlock: one, statementAccount: { accountId: 'z', name: 'Zweitbank', lastMovementOn: null, balanceAtYearEndCents: 0 }, endsOn: '2025-12-31', closingLink: true });
    expect(button(FINALIZE())).toBeNull();
    fireEvent.click(screen.getByTestId('report-statement-file'));
    expect(await screen.findByTestId('closing-statement-dialog')).toBeTruthy();
    expect(screen.queryByTestId('report-to-statements')).toBeNull();
    cleanup();
    view({ finalizeBlock: { code: 'reportStatementsMissing', params: { designation: '2025', accounts: 'Zweitbank, Drittbank', count: 2 } }, statementAccount: null, closingLink: true });
    expect(screen.queryByTestId('report-statement-file')).toBeNull();
    expect(screen.getByTestId('report-to-statements').getAttribute('href')).toBe('/finance/closing?year=y25#step-statements');
    cleanup();
    view({ stage: 'preliminary', finalizeBlock: { code: 'reportYearOpen', params: { designation: '2025' } }, closingLink: true });
    expect(screen.getByTestId('report-to-close').getAttribute('href')).toBe('/finance/closing?year=y25#step-close');
  });

  it('offers the download among the side actions', () => {
    view();
    expect(button(m('finance.reports.view.download'))).not.toBeNull();
  });
});

describe('ReportView: Parameter, Hinweise, Rahmen', () => {
  it('writes the year into the address and offers combining only where allowed', () => {
    view({ reportKey: 'incomeStatement', combineAllowed: true });
    fireEvent.change(screen.getByLabelText(m('finance.reports.view.params.year')), { target: { value: 'y24' } });
    expect(replace).toHaveBeenCalledWith('/finance/reports/incomeStatement?year=y24');
    expect(screen.getByRole('checkbox', { name: m('finance.reports.view.params.combine') })).toBeTruthy();
    cleanup();
    view({ reportKey: 'incomeStatement', combineAllowed: false });
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('drops the combined view when the year changes — it may not be allowed there', () => {
    view({ reportKey: 'incomeStatement', combineAllowed: true, params: { fiscalYearId: 'y25', combineOperations: true } });
    fireEvent.change(screen.getByLabelText(m('finance.reports.view.params.year')), { target: { value: 'y24' } });
    expect(replace).toHaveBeenCalledWith('/finance/reports/incomeStatement?year=y24');
  });

  it('offers the projects of the project statement, all projects first (Rechenschaft B1)', () => {
    view({ reportKey: 'projectStatement', orientation: 'portrait', projects: [{ id: 'p1', name: 'Brunnenbau' }, { id: 'p2', name: 'Schulgarten' }] });
    const select = screen.getByLabelText(m('finance.reports.view.params.project')) as HTMLSelectElement;
    expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([['', m('finance.reports.view.params.allProjects')], ['p1', 'Brunnenbau'], ['p2', 'Schulgarten']]);
    fireEvent.change(select, { target: { value: 'p2' } });
    expect(replace).toHaveBeenCalledWith('/finance/reports/projectStatement?year=y25&project=p2');
    cleanup();
    replace.mockReset();
    view({ reportKey: 'projectStatement', orientation: 'portrait', params: { fiscalYearId: 'y25', projectId: 'p2' }, projects: [] });
    expect([...(screen.getByLabelText(m('finance.reports.view.params.project')) as HTMLSelectElement).options].map((o) => o.value)).toEqual(['']);
    // Ein anderes Jahr beginnt mit allen Projekten.
    fireEvent.change(screen.getByLabelText(m('finance.reports.view.params.year')), { target: { value: 'y24' } });
    expect(replace).toHaveBeenCalledWith('/finance/reports/projectStatement?year=y24');
  });

  it('asks the handover list for a day instead of a year', () => {
    view({ reportKey: 'handoverList', orientation: 'portrait', params: { date: '2026-10-24' } });
    expect(screen.queryByLabelText(m('finance.reports.view.params.year'))).toBeNull();
    const day = screen.getByLabelText(m('finance.reports.view.params.date')) as HTMLInputElement;
    expect(day.type).toBe('date');
    expect(day.value).toBe('2026-10-24');
    fireEvent.change(day, { target: { value: '2026-06-30' } });
    expect(replace).toHaveBeenCalledWith('/finance/reports/handoverList?date=2026-06-30');
    expect(screen.getAllByRole('img')[0]!.getAttribute('src')).toBe('/finance/reports/handoverList/page/1?date=2026-10-24');
  });

  it('names the year parameter after the report: calendar year where the report counts one (yearKind)', () => {
    view({ reportKey: 'donationBook', yearKind: 'calendar', years: [{ id: 'y25', designation: '2024/25', calendarYear: '2025' }] });
    const select = screen.getByLabelText(m('finance.reports.view.params.calendarYear')) as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toEqual(['2025']);
    cleanup();
    view({ years: [{ id: 'y25', designation: '2024/25', calendarYear: '2025' }] });
    expect([...(screen.getByLabelText(m('finance.reports.view.params.year')) as HTMLSelectElement).options].map((o) => o.text)).toEqual(['2024/25']);
  });

  it('shows every warning of the new reports', () => {
    const codes = ['freeReserveCapExceeded', 'allowanceExceeded', 'linesWithoutPerson', 'section18_4a', 'taxContextMissing'];
    view({ warnings: codes });
    expect(screen.getAllByRole('status')).toHaveLength(codes.length);
    for (const code of codes) expect(document.body.textContent).toContain(m(`finance.reports.view.warnings.${code}`));
  });

  it('warns above the pages and shows them as images, with the PDF behind „PDF öffnen“', () => {
    view({ warnings: ['businessLoss'], probeDifferenceCents: -500 });
    expect(screen.getAllByRole('status').length).toBe(2);
    const sheets = screen.getAllByRole('img');
    expect(sheets.map((s) => s.getAttribute('src'))).toEqual(['/finance/reports/cashReport/page/1?year=y25', '/finance/reports/cashReport/page/2?year=y25']);
    expect(sheets[0]!.getAttribute('srcset')).toContain('/finance/reports/cashReport/page/1?year=y25&scale=2 2x');
    const open = screen.getByRole('link', { name: m('common.pdfPages.open') });
    expect(open.getAttribute('href')).toBe('/finance/reports/cashReport/preview?year=y25');
  });
});

describe('ReportView: Fassungen und Festschreiben', () => {
  const version = (over: Partial<Props['versions'][number]> = {}): Props['versions'][number] => ({ reportId: 'r1', finalizedAt: '2026-02-10T17:30:00.000Z', byName: 'Anna Berger', shortHash: '3e90b4d2', documentNumber: 'FBR-2026-0001', voidedAt: null, voidReason: null, ...over });

  it('after signing the annual accounts shows and downloads the signed version; a web version is a row of its own (Bildabnahme 0.4.5 F-3)', () => {
    const finalVersion = { reportId: 'r1', finalizedAt: '2026-02-10T17:30:00.000Z', documentId: 'd1', documentNumber: 'FBR-2026-009', shortHash: '3e90b4d2', signedCopy: { documentId: 'd2', documentNumber: 'FBR-2026-010' } };
    view({ reportKey: 'annualAccounts', stage: 'final', finalVersion, versions: [version({ documentNumber: 'FBR-2026-009', webCopies: [{ documentId: 'd3', documentNumber: 'FBR-2026-011', on: '2026-09-05' }] })] });
    const sheets = screen.getAllByRole('img');
    expect(sheets[0]!.getAttribute('src')).toBe('/finance/reports/versions/r1/page/1?document=d2');
    expect(sheets[0]!.getAttribute('srcset')).toContain('/finance/reports/versions/r1/page/1?document=d2&scale=2 2x');
    expect(screen.getByRole('link', { name: m('common.pdfPages.open') }).getAttribute('href')).toBe('/finance/reports/versions/r1/file?document=d2');
    expect(document.querySelector('.font-mono')!.textContent).toContain('FBR-2026-010');
    const rows = document.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByRole('link').getAttribute('href')).toBe('/finance/reports/versions/r1/file');
    expect(rows[1]!.textContent).toContain('Webfassung vom 05.09.2026');
    expect(rows[1]!.textContent).toContain('FBR-2026-011');
    expect(within(rows[1] as HTMLElement).getByRole('link').getAttribute('href')).toBe('/finance/reports/versions/r1/file?document=d3');
  });

  it('lists versions, the withdrawn ones greyed with their reason; empty says so', () => {
    view({ versions: [version({ reportId: 'r2' }), version({ voidedAt: '2026-02-12T09:00:00.000Z', voidReason: 'Ersetzt durch FBR-2026-0002' })] });
    const muted = document.querySelector('tr[data-muted]')!;
    expect(muted.textContent).toContain('Ersetzt durch FBR-2026-0002');
    expect(muted.textContent).toContain(m('common.muted.withdrawn'));
    expect(within(muted as HTMLElement).getByRole('link').getAttribute('href')).toBe('/finance/reports/versions/r1/file');
    cleanup();
    view({ versions: [version()], canOpenVersions: false });
    expect(document.querySelector('tbody a')).toBeNull();
    cleanup();
    view();
    expect(document.body.textContent).toContain(m('finance.reports.view.versions.empty'));
  });

  it('confirms before finalizing and keeps the dialog open on refusal', async () => {
    finalizeReportAction.mockResolvedValue({ status: 'error', message: 'Die Zahlen haben sich geändert.', fieldErrors: {} });
    view();
    fireEvent.click(button(FINALIZE())!);
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Kassenbericht 2025 festschreiben')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: FINALIZE() }));
    await waitFor(() => expect(finalizeReportAction).toHaveBeenCalledWith('cashReport', { fiscalYearId: 'y25' }));
    expect(await within(dialog).findByText('Die Zahlen haben sich geändert.')).toBeTruthy();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });
});

describe('ReportView: Zweck aus der Gruppe des Katalogs, laufendes Jahr (Designer Runde 7, 247/239, 249)', () => {
  it('names the group the catalogue gives the report — the same the list groups it under', async () => {
    const { reportDefinition, REPORT_CATALOG } = await import('@kompass/module-finance');
    for (const def of REPORT_CATALOG.filter((d) => d.available)) {
      view({ reportKey: def.key, group: def.group, orientation: def.orientation });
      const purpose = document.querySelector('[data-slot="page-header"] p')?.textContent ?? document.body.textContent!;
      const group = m(`finance.reports.groups.${def.group}`);
      // Die Gruppe der Liste steckt im Satz (bei „Arbeit“ als „laufende Arbeit“).
      expect(purpose).toContain(group === 'Arbeit' ? 'laufende Arbeit' : group);
      cleanup();
    }
    expect(reportDefinition('incomeStatement')!.group).toBe('assembly');
  });

  it('in the running year only says the year is running, without a link to step 8; after its end the link stays', () => {
    const open = { code: 'reportYearOpen' as const, params: { designation: '2026' } };
    view({ stage: 'preliminary', finalizeBlock: open, running: true, closingLink: true, year: { id: 'y26', designation: '2026' } });
    expect(document.body.textContent).toContain('2026 läuft noch.');
    expect(screen.queryByTestId('report-to-close')).toBeNull();
    cleanup();
    view({ stage: 'preliminary', finalizeBlock: open, running: false, closingLink: true, year: { id: 'y26', designation: '2026' } });
    expect(screen.queryByTestId('report-to-close')).not.toBeNull();
  });
});
