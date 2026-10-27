// @vitest-environment jsdom
import type { ClosingStatus, ClosingStepFacts, ClosingStepView } from '@kompass/module-finance';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }), usePathname: () => '/finance/closing', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/app/(shell)/dms/search-action', () => ({ searchDocumentsAction: vi.fn(async () => []) }));
vi.mock('@/app/(shell)/finance/closing/actions', () => ({ confirmStepAction: vi.fn(), closeYearAction: vi.fn(), reopenYearAction: vi.fn(), carryOverAction: vi.fn(async () => ({ status: 'success' })) }));
vi.mock('@/app/(shell)/finance/audit/actions', () => ({ startPackageRunAction: vi.fn(), cancelPackageRunAction: vi.fn(), fileScanAction: vi.fn(), fileScanFromDocumentAction: vi.fn() }));
vi.mock('@/app/(shell)/finance/reports/actions', () => ({ releaseYearAction: vi.fn(), uploadAuditReportAction: vi.fn() }));
const { AuditPackageStep } = await import('@/app/(shell)/finance/closing/steps/audit-package');
const { AuditReportStep } = await import('@/app/(shell)/finance/closing/steps/audit-report');
const { carryOverAction } = await import('@/app/(shell)/finance/closing/actions');

afterEach(cleanup);
beforeEach(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  vi.clearAllMocks();
});

/** Schritte 9 und 10 mit Nachprüfung (Plan C2 Task 5, Board 10c, 11b, 13c). */
const m = (path: string) => path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], messages) as string;
const wrap = (node: ReactNode) => render(<NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">{node}</NextIntlClientProvider>);
const STATUS = (over: Partial<ClosingStatus> = {}) => ({ fiscalYearId: 'y25', designation: '2025', startsOn: '2025-01-01', endsOn: '2025-12-31', ended: true, yearStatus: 'closed', doneCount: 8, next: 'auditReport', reopened: null, toRepeat: [], handovers: [], steps: [], me: { canConfirm: true, canClose: true, canHandover: false }, ...over }) as ClosingStatus;
const view = <F extends ClosingStepFacts>(facts: F): ClosingStepView<F> => ({ key: facts.key, number: 10, group: 'after', done: false, confirmable: false, confirmation: null, facts });
type Report = Extract<ClosingStepFacts, { key: 'auditReport' }>;
const report = (over: Partial<Report> = {}): Report => ({ key: 'auditReport', release: null, filedAt: null, followUpOpen: false, changedEntries: 0, baselineAt: null, afterAssembly: false, followUpReportId: null, followUpReadyToSign: false, assemblyReports: { done: 2, total: 3 }, statementsMissing: [], carryOver: null, ...over });
const RELEASE = { basis: 'auditReport' as const, note: null, documentId: 'd1', at: '2026-02-18T10:00:00Z', byUserId: 'u1' };
const step10 = (facts: Report, status = STATUS()) => <AuditReportStep step={view(facts)} status={status} canConfirm onConfirm={() => undefined} nextDesignation="2026" />;

describe('Schritt 9', () => {
  it('Prüfer als Satz mit Art, fehlender Zugang mit Link auf die Kassenprüfung; ohne Prüfer der Weg zum Eintragen', () => {
    wrap(<AuditPackageStep step={view({ key: 'auditPackage', auditors: [{ id: 'a1', name: 'Klaus Schulz', mode: 'kompass', accessOk: false }, { id: 'a2', name: 'Brigitte Baumann', mode: 'paper', accessOk: true }], packageRun: 'none', skippedBy: null, package: null })} status={STATUS({ yearStatus: 'open' })} canConfirm onConfirm={() => undefined} packageRun={null} />);
    expect(screen.getByTestId('closing-auditors').textContent).toContain('Brigitte Baumann');
    const missing = screen.getByTestId('closing-access-missing');
    expect(missing.textContent).toContain('Klaus Schulz');
    expect(within(missing).getByRole('link').getAttribute('href')).toBe('/finance/audit?year=y25');
    cleanup();
    wrap(<AuditPackageStep step={view({ key: 'auditPackage', auditors: [], packageRun: 'none', skippedBy: null, package: null })} status={STATUS()} canConfirm onConfirm={() => undefined} packageRun={null} />);
    expect(screen.getByRole('link', { name: m('finance.closing.auditPackage.addAuditors') }).getAttribute('href')).toBe('/finance/audit?year=y25');
  });
});

describe('Schritt 10 ohne Nachprüfung', () => {
  it('ohne Freigabe: Weg zur Kassenprüfung und „Freigeben …“ (nur mit Recht)', () => {
    wrap(step10(report()));
    expect(screen.getByTestId('closing-release')).toBeTruthy();
    cleanup();
    wrap(step10(report(), STATUS({ me: { canConfirm: false, canClose: false, canHandover: false, canCount: false, canRunConfirmations: false } })));
    expect(screen.queryByTestId('closing-release')).toBeNull();
    expect(screen.getByRole('link', { name: m('finance.closing.auditPackage.toAudit') })).toBeTruthy();
  });

  it('freigegeben, Auszug fehlt: Satz mit Link auf Schritt 1; sonst der Weg zum Festschreiben', () => {
    wrap(step10(report({ release: RELEASE, statementsMissing: [{ accountId: 'z', name: 'Zweitbank' }] })));
    const missing = screen.getByTestId('closing-statements-missing');
    expect(missing.textContent).toContain('Zweitbank');
    expect(within(missing).getByRole('link').getAttribute('href')).toBe('#step-statements');
    expect(screen.queryByTestId('closing-finalize')).toBeNull();
    cleanup();
    wrap(step10(report({ release: RELEASE })));
    expect(screen.getByTestId('closing-finalize').getAttribute('href')).toBe('/finance/reports?year=y25');
  });
});

describe('Nachprüfung (10c)', () => {
  it('vor der MV: nur der Nachtrag; zum Unterschreiben bereit → „Nachtrag ablegen …“, sonst der Weg zur Kassenprüfung', () => {
    wrap(step10(report({ release: RELEASE, followUpOpen: true, changedEntries: 2, baselineAt: '2026-02-02T10:00:00Z', followUpReportId: 'f1', followUpReadyToSign: true })));
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.getByTestId('closing-addendum-file')).toBeTruthy();
    cleanup();
    wrap(step10(report({ release: RELEASE, followUpOpen: true, changedEntries: 2 })));
    expect(screen.queryByTestId('closing-addendum-file')).toBeNull();
    expect(within(screen.getByTestId('closing-addendum')).getByRole('link').getAttribute('href')).toBe('/finance/audit?year=y25');
  });

  it('ohne geänderte Buchung (Befund 3): keine Wahl, nur „Bestätigen …“', () => {
    const onConfirm = vi.fn();
    const facts = report({ followUpOpen: true, changedEntries: 0, afterAssembly: true, baselineAt: '2026-02-02T10:00:00Z' });
    wrap(<AuditReportStep step={{ ...view(facts), confirmable: true }} status={STATUS()} canConfirm onConfirm={onConfirm} nextDesignation="2026" />);
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.queryByTestId('closing-addendum')).toBeNull();
    expect(screen.getByTestId('closing-body-auditReport').textContent).toContain('02.02.2026');
    fireEvent.click(screen.getByRole('button', { name: m('finance.closing.confirm') }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('nach der MV: zwei Karten ohne Vorwahl; „Bestätigen …“ erst nach „Übernehmen“, mit Begründung', async () => {
    wrap(step10(report({ release: RELEASE, followUpOpen: true, changedEntries: 1, afterAssembly: true })));
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(radios.every((r) => r.getAttribute('aria-checked') !== 'true' && !(r as HTMLInputElement).checked)).toBe(true);
    expect(screen.queryByTestId('closing-carry-over')).toBeNull();
    fireEvent.click(screen.getByText(m('finance.closing.auditReport.followUp.addendum')));
    expect(screen.queryByTestId('closing-carry-over')).toBeNull();
    expect(screen.getByTestId('closing-addendum')).toBeTruthy();
    fireEvent.click(screen.getByText(m('finance.closing.auditReport.followUp.carryOver')));
    fireEvent.click(screen.getByTestId('closing-carry-over'));
    const dialog = await screen.findByTestId('closing-carry-over-dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Barbeleg nachgebucht.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: m('finance.closing.carryOverDialog.save') }));
    await waitFor(() => expect(carryOverAction).toHaveBeenCalledWith('y25', 'Barbeleg nachgebucht.'));
  });
});
