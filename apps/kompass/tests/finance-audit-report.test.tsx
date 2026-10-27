// @vitest-environment jsdom
import type { AuditReportView } from '@kompass/module-finance';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

const actions = vi.hoisted(() => ({ saveExaminationAction: vi.fn(), saveResultAction: vi.fn(), saveDeviationAction: vi.fn(), saveSignaturesAction: vi.fn(), markReadyAction: vi.fn(), revokeReadyAction: vi.fn(), createReportDraftAction: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/(shell)/finance/audit/actions', () => actions);
const { ExaminationCard } = await import('@/app/(shell)/finance/audit/report/examination-card');
const { ResultCards } = await import('@/app/(shell)/finance/audit/report/result-card');
const { SignaturesCard } = await import('@/app/(shell)/finance/audit/report/signatures-card');
const { ReportHeader } = await import('@/app/(shell)/finance/audit/report/report-header');
const { UnsavedCardsProvider } = await import('@/app/(shell)/finance/audit/report/unsaved-cards');
afterEach(cleanup);
beforeEach(() => {
  Object.values(actions).forEach((a) => a.mockReset());
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});

const m = (path: string) => path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], messages) as string;
const wrap = (node: React.ReactNode) => render(<NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">{node}</NextIntlClientProvider>);

const report = (over: Partial<AuditReportView> = {}): AuditReportView => ({
  id: 'r1', fiscalYearId: 'y25', kind: 'report', origin: 'kompass', state: 'draft',
  subject: { designation: '2025', startsOn: '2025-01-01', endsOn: '2025-12-31', baseline: { id: 'b1', createdAt: '2026-02-02T10:00:00.000Z', kind: 'initial' }, reports: [], samples: { sampledEntries: 24, totalEntries: 212 }, sectionsReviewed: { reviewed: 5, total: 8 }, cash: null, changedEntryIds: [] },
  examination: { dates: ['2026-02-18'], place: 'Vereinsheim', notTested: null, cashCountId: null, updatedAt: '2026-02-18T15:40:00.000Z', updatedByUserId: 'u1', version: 'exam-v1' },
  cashCounts: [], findings: [], openQuestions: [], suggestedResult: 'clean', openRemarks: 0, notices: [],
  results: [{ auditorId: null, result: null, recommendation: 'none', updatedAt: null, updatedByUserId: null, version: 'res-v0' }],
  deviations: [], signatures: { mode: 'both', nonSignerAuditorId: null, nonSignerReason: null, updatedAt: null, updatedByUserId: null, version: 'sig-v0' },
  auditors: [{ id: 'a1', contactName: 'Klara Prüf', mode: 'kompass' }, { id: 'a2', contactName: 'Paula Papier', mode: 'paper' }],
  scans: [], scansExpected: 1, readyAt: null, filedAt: null, lastPrintedAt: null, editorNames: [], lastEditedAt: null, canEdit: true, myAuditorId: 'a1', ...over,
});
const names = { u1: 'Klara Prüf' };

describe('Karte „Prüfung“ (12d)', () => {
  it('saves with its own version and says who changed it last', async () => {
    actions.saveExaminationAction.mockResolvedValue({ status: 'success' });
    wrap(<ExaminationCard report={report()} canEdit names={names} cashCounts={[]} />);
    expect(screen.getByTestId('exam-card').textContent).toContain('Klara Prüf');
    fireEvent.click(screen.getByRole('button', { name: m('finance.audit.report.exam.addDate') }));
    const dates = screen.getAllByLabelText(new RegExp(m('finance.audit.report.exam.dates')));
    fireEvent.change(dates[1]!, { target: { value: '2026-02-19' } });
    fireEvent.click(within(screen.getByTestId('exam-card')).getByRole('button', { name: m('common.save') }));
    await waitFor(() => expect(actions.saveExaminationAction).toHaveBeenCalledWith({ reportId: 'r1', expectedVersion: 'exam-v1', dates: ['2026-02-18', '2026-02-19'], place: 'Vereinsheim', notTested: null, cashCountId: null }));
  });

  it('an added day can be removed again, the first one cannot (Plan D1d Task 6)', async () => {
    actions.saveExaminationAction.mockResolvedValue({ status: 'success' });
    wrap(<ExaminationCard report={report({ examination: { ...report().examination, dates: ['2026-02-18', '2026-02-19'] } })} canEdit names={names} cashCounts={[]} />);
    const removers = screen.getAllByRole('button', { name: /entfernen/i });
    expect(removers).toHaveLength(1);
    fireEvent.click(removers[0]!);
    expect(screen.getAllByLabelText(new RegExp(m('finance.audit.report.exam.dates')))).toHaveLength(1);
    fireEvent.click(within(screen.getByTestId('exam-card')).getByRole('button', { name: m('common.save') }));
    await waitFor(() => expect(actions.saveExaminationAction).toHaveBeenCalledWith(expect.objectContaining({ dates: ['2026-02-18'] })));
  });

  it('without the right to edit: text only, no bar', () => {
    wrap(<ExaminationCard report={report({ canEdit: false })} canEdit={false} names={names} cashCounts={[]} />);
    expect(screen.queryByRole('button', { name: m('common.save') })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('Vereinsheim')).toBeTruthy();
  });
});

describe('Ergebnis (12d, getrennte Berichte)', () => {
  it('with separate reports each auditor has his own card — only the own one is editable', () => {
    wrap(<ResultCards report={report({ signatures: { mode: 'separate', nonSignerAuditorId: null, nonSignerReason: null, updatedAt: null, updatedByUserId: null, version: 's' }, results: [{ auditorId: 'a1', result: null, recommendation: 'none', updatedAt: null, updatedByUserId: null, version: 'r-a1' }, { auditorId: 'a2', result: null, recommendation: 'none', updatedAt: null, updatedByUserId: null, version: 'r-a2' }] })} canEdit names={names} />);
    const cards = screen.getAllByTestId('result-card');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getAllByRole('radio').length).toBeGreaterThan(0);
    expect(within(cards[1]!).queryAllByRole('radio')).toHaveLength(0);
  });

  it('saves result and recommendation with the version of the card; the suggestion is a hint', async () => {
    actions.saveResultAction.mockResolvedValue({ status: 'success' });
    wrap(<ResultCards report={report({ suggestedResult: 'withFindings' })} canEdit names={names} />);
    expect(screen.getByText(m('finance.audit.report.result.suggest.withFindings'))).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: m('finance.audit.report.result.withFindings') }));
    fireEvent.click(screen.getByRole('radio', { name: m('finance.audit.report.result.discharge') }));
    fireEvent.click(within(screen.getByTestId('result-card')).getByRole('button', { name: m('common.save') }));
    await waitFor(() => expect(actions.saveResultAction).toHaveBeenCalledWith({ reportId: 'r1', expectedVersion: 'res-v0', result: 'withFindings', recommendation: 'discharge' }));
  });
});

// N15: „Ohne Beanstandung“ trotz ungeklärter Vermerke warnt am Ergebnis, sperrt aber nicht.
describe('Ergebnis mit ungeklärten Vermerken', () => {
  it('warns while „clean“ is chosen and open remarks exist, and still saves', async () => {
    actions.saveResultAction.mockResolvedValue({ status: 'success' });
    wrap(<ResultCards report={report({ openRemarks: 2 })} canEdit names={names} />);
    expect(screen.queryByTestId('open-remarks-notice')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: m('finance.audit.report.result.clean') }));
    expect(screen.getByTestId('open-remarks-notice').textContent).toMatch(/\b2\b/);
    fireEvent.click(within(screen.getByTestId('result-card')).getByRole('button', { name: m('common.save') }));
    await waitFor(() => expect(actions.saveResultAction).toHaveBeenCalledWith(expect.objectContaining({ result: 'clean' })));
    fireEvent.click(screen.getByRole('radio', { name: m('finance.audit.report.result.withFindings') }));
    expect(screen.queryByTestId('open-remarks-notice')).toBeNull();
  });

  it('shows nothing without open remarks', () => {
    wrap(<ResultCards report={report({ results: [{ auditorId: null, result: 'clean', recommendation: 'discharge', updatedAt: null, updatedByUserId: null, version: 'v' }] })} canEdit={false} names={names} />);
    expect(screen.queryByTestId('open-remarks-notice')).toBeNull();
  });
});

describe('Karten bleiben stehen, wenn ein anderer speichert (Konflikt je Karte)', () => {
  it('a new stand of the card from the server keeps what is typed in it', () => {
    const view = render(<NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin"><ExaminationCard report={report()} canEdit names={names} cashCounts={[]} /><ResultCards report={report()} canEdit names={names} /></NextIntlClientProvider>);
    fireEvent.change(screen.getByLabelText(m('finance.audit.report.exam.place')), { target: { value: 'Gemeindehaus' } });
    fireEvent.change(screen.getByRole('textbox', { name: new RegExp('Abweichende Feststellungen') }), { target: { value: 'Keine.' } });
    const newer = report({ examination: { ...report().examination, version: 'exam-v2', place: 'Vereinsheim' }, results: [{ ...report().results[0]!, version: 'res-v1' }] });
    view.rerender(<NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin"><ExaminationCard report={newer} canEdit names={names} cashCounts={[]} /><ResultCards report={newer} canEdit names={names} /></NextIntlClientProvider>);
    expect((screen.getByLabelText(m('finance.audit.report.exam.place')) as HTMLInputElement).value).toBe('Gemeindehaus');
    expect((screen.getByRole('textbox', { name: new RegExp('Abweichende Feststellungen') }) as HTMLTextAreaElement).value).toBe('Keine.');
  });
});

describe('Unterschriften (12d)', () => {
  it('„Einer unterschreibt“ asks who does not sign and why', async () => {
    actions.saveSignaturesAction.mockResolvedValue({ status: 'success' });
    wrap(<SignaturesCard report={report()} canEdit names={names} />);
    expect(screen.queryByLabelText(m('finance.audit.report.signatures.nonSigner'))).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(m('finance.audit.report.signatures.modes.one.label')) }));
    fireEvent.change(screen.getByLabelText(m('finance.audit.report.signatures.nonSigner')), { target: { value: 'a2' } });
    fireEvent.change(screen.getByRole('textbox', { name: new RegExp(`^${m('finance.audit.report.signatures.reason')}`) }), { target: { value: 'Verhindert' } });
    fireEvent.click(within(screen.getByTestId('signatures-card')).getByRole('button', { name: m('common.save') }));
    await waitFor(() => expect(actions.saveSignaturesAction).toHaveBeenCalledWith({ reportId: 'r1', expectedVersion: 'sig-v0', mode: 'one', nonSignerAuditorId: 'a2', nonSignerReason: 'Verhindert' }));
  });
});

describe('Kopf des Prüfberichts', () => {
  it('the editor releases for signing from the header; others see no primary action', async () => {
    actions.markReadyAction.mockResolvedValue({ status: 'success' });
    wrap(<ReportHeader report={report()} yearId="y25" designation="2025" canPrint />);
    fireEvent.click(screen.getByRole('button', { name: m('finance.audit.report.ready.open') }));
    fireEvent.click(await screen.findByRole('button', { name: m('finance.audit.report.ready.confirm') }));
    await waitFor(() => expect(actions.markReadyAction).toHaveBeenCalledWith('r1'));
    cleanup();
    wrap(<ReportHeader report={report({ canEdit: false })} yearId="y25" designation="2025" canPrint={false} />);
    expect(screen.queryByRole('button', { name: m('finance.audit.report.ready.open') })).toBeNull();
  });

  it('releasing with unsaved changes in a card names the card in the question (Plan D1d Task 6)', async () => {
    wrap(
      <UnsavedCardsProvider>
        <ReportHeader report={report()} yearId="y25" designation="2025" canPrint />
        <ExaminationCard report={report()} canEdit names={names} cashCounts={[]} />
      </UnsavedCardsProvider>,
    );
    fireEvent.change(screen.getByLabelText(m('finance.audit.report.exam.place')), { target: { value: 'Rathaus' } });
    fireEvent.click(screen.getByRole('button', { name: m('finance.audit.report.ready.open') }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(new RegExp(m('finance.audit.report.exam.title').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeTruthy();
    expect(screen.queryByRole('button', { name: m('finance.audit.report.ready.open') })).toBeNull();
  });
});
