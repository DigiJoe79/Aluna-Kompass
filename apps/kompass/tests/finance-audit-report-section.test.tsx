// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

const actions = vi.hoisted(() => ({ writeAuditReportAction: vi.fn(), fileScanAction: vi.fn(), fileScanFromDocumentAction: vi.fn(), startPackageRunAction: vi.fn(), cancelPackageRunAction: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/(shell)/finance/audit/actions', () => actions);
vi.mock('@/app/(shell)/dms/search-action', () => ({ searchDocumentsAction: vi.fn(async () => []) }));
const { ReportSection } = await import('@/app/(shell)/finance/audit/report-section');
const { packageRunSteps } = await import('@/app/(shell)/finance/audit/package-run-card');
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  Object.values(actions).forEach((a) => a.mockReset());
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});

const m = (path: string) => path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], messages) as string;
const data = (over: Partial<React.ComponentProps<typeof ReportSection>['data']> = {}): React.ComponentProps<typeof ReportSection>['data'] => ({
  yearId: 'y25', designation: '2025', auditorView: false, canManage: true, canFile: true, cash: { done: false, keepers: ['Anna Kasse', 'Ben Buch'] }, remarksOpen: 0, reviewed: 3, total: 8,
  lines: [], scanTarget: null, scanAuditors: [], onlyPaper: false, followUpHref: null, followUpOpen: false, writeDraft: false, packageRun: null, ...over,
});
const wrap = (d: ReturnType<typeof data>) => render(<NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin"><ReportSection data={d} /></NextIntlClientProvider>);

describe('Abschnitt „Prüfbericht“ (Board 4e, 12e)', () => {
  it('the treasurer counts the cash; the auditor asks the cash keepers', () => {
    wrap(data());
    expect(within(screen.getByTestId('requirement-cash')).getByRole('link', { name: m('finance.audit.reportSection.cashAction') }).getAttribute('href')).toBe('/finance/cash');
    cleanup();
    wrap(data({ auditorView: true, canManage: false, canFile: false }));
    const cash = screen.getByTestId('requirement-cash');
    expect(within(cash).queryByRole('link')).toBeNull();
    expect(cash.textContent).toContain('Anna Kasse');
    expect(cash.textContent).toContain('Ben Buch');
  });

  it('„Prüfbericht schreiben“ creates and opens the draft in one step; a refusal stands above the button (Designer Runde 4)', async () => {
    actions.writeAuditReportAction.mockResolvedValue({ status: 'error', message: 'Nicht erlaubt.', fieldErrors: {} });
    wrap(data({ auditorView: true, canManage: false, canFile: true, writeDraft: true }));
    fireEvent.click(screen.getByRole('button', { name: m('finance.audit.reportSection.draftCreate') }));
    await waitFor(() => expect(actions.writeAuditReportAction).toHaveBeenCalled());
    expect(actions.writeAuditReportAction.mock.calls[0]![0]).toBe('y25');
    expect(await screen.findByText('Nicht erlaubt.')).toBeTruthy();
    cleanup();
    wrap(data());
    expect(screen.queryByRole('button', { name: m('finance.audit.reportSection.draftCreate') })).toBeNull();
  });

  it('„Scan ablegen …“ only with a report ready to sign; separate reports ask whose', async () => {
    wrap(data());
    expect(screen.queryByRole('button', { name: m('finance.audit.reportSection.scan') })).toBeNull();
    cleanup();
    actions.fileScanFromDocumentAction.mockResolvedValue({ status: 'error', message: 'x', fieldErrors: { auditorId: 'Bitte wählen Sie den Prüfer.' } });
    wrap(data({ scanTarget: { reportId: 'r1' }, scanAuditors: [{ id: 'a1', name: 'Klara Prüf' }, { id: 'a2', name: 'Paula Papier' }] }));
    fireEvent.click(screen.getByRole('button', { name: m('finance.audit.reportSection.scan') }));
    const dialog = await screen.findByTestId('scan-dialog');
    expect(within(dialog).getByLabelText(new RegExp(m('finance.audit.scanDialog.auditor')))).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: m('finance.audit.scanDialog.save') }));
    await waitFor(() => expect(actions.fileScanFromDocumentAction).toHaveBeenCalledWith({ reportId: 'r1', documentId: '' }));
    expect(await within(dialog).findByText('Bitte wählen Sie den Prüfer.')).toBeTruthy();
  });

  it('after filing, the requirements are no longer shown — only the line of the filed report; a waiting addendum brings them back', () => {
    const line = (kind: 'report' | 'followUp', state: 'draft' | 'filed') => ({ kind, state, origin: 'kompass' as const, editorNames: [], lastEditedAt: null, lastPrintedAt: null, readyAt: null, filedAt: state === 'filed' ? '2026-02-20T10:00:00.000Z' : null, scansFiled: 0, scansExpected: 1, documents: [], href: '/finance/audit/report?year=y25' });
    wrap(data({ lines: [line('report', 'filed')] }));
    expect(screen.queryByTestId('requirement-cash')).toBeNull();
    expect(screen.getByTestId('audit-report-line-report')).toBeTruthy();
    cleanup();
    wrap(data({ lines: [line('report', 'filed')], followUpOpen: true, followUpHref: '/finance/audit/report?year=y25&kind=followUp' }));
    expect(screen.getByTestId('requirement-cash')).toBeTruthy();
    cleanup();
    // Auch wer den Nachtrag nicht schreibt (Schatzmeisterin), sieht die Voraussetzungen, solange er wartet (D1e, M3).
    wrap(data({ lines: [line('report', 'filed')], followUpOpen: true }));
    expect(screen.getByTestId('requirement-cash')).toBeTruthy();
    cleanup();
    wrap(data({ lines: [line('report', 'filed'), line('followUp', 'draft')] }));
    expect(screen.getByTestId('requirement-cash')).toBeTruthy();
    cleanup();
    // Nachprüfung ohne geänderte Buchung (260/261 Telefon): kein Nachtrag nötig, also keine Voraussetzungen und kein Weg dorthin.
    wrap(data({ lines: [line('report', 'filed')], followUpOpen: true, followUpUnchanged: true, followUpHref: '/finance/audit/report?year=y25&kind=followUp' }));
    expect(screen.queryByTestId('requirement-cash')).toBeNull();
    expect(screen.queryByRole('link', { name: m('finance.audit.reportSection.followUpCreate') })).toBeNull();
  });

  it('only paper auditors: the blank form is printed by POST', async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([37, 80, 68, 70]), { headers: { 'content-disposition': 'attachment; filename="Vordruck.pdf"' } }));
    vi.stubGlobal('fetch', fetch);
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
    globalThis.URL.revokeObjectURL = vi.fn();
    wrap(data({ onlyPaper: true }));
    expect(screen.getByTestId('audit-only-paper').textContent).toContain(m('finance.audit.reportSection.onlyPaper'));
    fireEvent.click(screen.getByRole('button', { name: m('finance.audit.reportSection.blank') }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/finance/audit/year/y25/blank', { method: 'POST' }));
  });
});

describe('Prüfpaket als Lauf', () => {
  const t = (key: string) => key;
  it('a skipped step says why; a failed run marks the running step', () => {
    expect(packageRunSteps({ state: 'success', runId: 'x', cancellable: false, steps: [{ key: 'reports', state: 'done' }, { key: 'folder', state: 'done' }, { key: 'archive', state: 'skipped' }], finishedAt: 'z', files: ['reports', 'folder'], skipped: { archive: 'noExportPermission' }, canStart: true }, t).map((s) => [s.key, s.state, s.note ?? null])).toEqual([
      ['reports', 'done', null],
      ['folder', 'done', null],
      ['archive', 'skipped', 'skipped.noExportPermission'],
    ]);
    expect(packageRunSteps({ state: 'failed', runId: 'x', cancellable: false, steps: [{ key: 'reports', state: 'done' }, { key: 'folder', state: 'running' }], finishedAt: 'z', files: [], skipped: {}, error: { code: 'c', message: 'Satz' }, canStart: true }, t)[1]).toMatchObject({ state: 'failed', note: 'Satz' });
  });
});
