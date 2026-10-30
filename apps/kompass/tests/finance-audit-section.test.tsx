// @vitest-environment jsdom
import type { AuditSectionRow } from '@kompass/module-finance';
import { ANOMALY_KINDS } from '@kompass/module-finance';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { summarizeSection } from '@/lib/finance/audit-package';

const actions = vi.hoisted(() => ({ setSampleAction: vi.fn(), markReviewedAction: vi.fn(), unmarkReviewedAction: vi.fn(), startPackageRunAction: vi.fn(), cancelPackageRunAction: vi.fn() }));
const refresh = vi.hoisted(() => vi.fn());
const toastRefusal = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, replace: vi.fn() }), usePathname: () => '/finance/audit/journal', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/app/(shell)/finance/audit/actions', () => actions);
vi.mock('@/lib/feedback', async (orig) => ({ ...(await orig<typeof import('@/lib/feedback')>()), toastRefusal }));
const { PackageTable } = await import('@/app/(shell)/finance/audit/package-table');
const { SectionTable } = await import('@/app/(shell)/finance/audit/[section]/section-table');
const { ReviewBar } = await import('@/app/(shell)/finance/audit/[section]/review-bar');
const { PackageRunCard } = await import('@/app/(shell)/finance/audit/package-run-card');
afterEach(cleanup);
beforeEach(() => {
  Object.values(actions).forEach((a) => a.mockReset());
  toastRefusal.mockReset();
  refresh.mockReset();
});

const m = (path: string) => path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], messages) as string;
const wrap = (node: React.ReactNode) => render(<NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">{node}</NextIntlClientProvider>);

const entry = (id: string, over: Partial<AuditSectionRow> = {}): AuditSectionRow => ({
  key: `entry:${id}`, kind: 'entry', entryId: id, date: '2025-06-14', amountCents: -35000, labelParams: { number: `2025-${id}`, text: `Buchung ${id}`, purposeOrCategory: 'Sommerfest', accountName: 'Kasse', state: 'final' }, sample: 'none', samplesByAll: 0, remarksOpen: 0, ...over,
});

describe('summarizeSection', () => {
  it('counts what the progress column says, per section, and the open remarks', () => {
    expect(summarizeSection('journal', [entry('1', { remarksOpen: 1 }), entry('2')], { samples: 24 })).toEqual({ counts: { samples: 24 }, remarksOpen: 1 });
    const voucher = (reason: string) => ({ key: reason + Math.random(), kind: 'voucher', date: null, amountCents: null, labelParams: { reason }, remarksOpen: 0 });
    expect(summarizeSection('vouchers', [voucher('missing'), voucher('missingJustified'), voucher('own'), voucher('withoutEntry')], { samples: 0 }).counts).toEqual({ missing: 2, own: 1, withoutEntry: 1, revoked: 0 });
    const account = (state: string) => ({ key: state, kind: 'account', date: null, amountCents: 0, labelParams: { state }, remarksOpen: 0 });
    expect(summarizeSection('reconciliation', [account('matches'), account('differs'), account('noStatement'), account('notReconcilable')], { samples: 0 }).counts).toEqual({ off: 2 });
  });
});

const summary = (section: string, over: Record<string, unknown> = {}) => ({ section, counts: {}, remarksOpen: 0, reviewedBy: [], reviewedByMe: false, reviewedBefore: null, ...over }) as never;

describe('PackageTable (Board 4a, 4e)', () => {
  const sections = () => [summary('journal', { counts: { samples: 24 }, reviewedBy: ['Klara Prüf'], reviewedByMe: true }), summary('reconciliation', { counts: { off: 0 } }), summary('vouchers', { counts: { missing: 0, own: 0, withoutEntry: 0, revoked: 0 } })];

  it('auditor: „Hier weiter“ at the first section he has not reviewed; links carry the year', () => {
    wrap(<PackageTable yearId="y25" sections={sections()} auditorView />);
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]!).queryByRole('link', { name: m('finance.audit.package.here') })).toBeNull();
    // Am Desktop in der Spalte rechts, am Telefon als Textlink unter der Fortschrittszeile (Designer Runde 4, 13a).
    const here = within(rows[1]!).getAllByRole('link', { name: m('finance.audit.package.here') });
    expect(here.map((l) => l.closest('td')!.getAttribute('data-col')).sort()).toEqual(['actions', 'meta']);
    for (const l of here) expect(l.getAttribute('href')).toBe('/finance/audit/reconciliation?year=y25');
    expect(within(rows[0]!).getAllByRole('link')[0]!.getAttribute('href')).toBe('/finance/audit/journal?year=y25');
    expect(within(rows[0]!).getByText(/Klara Prüf/)).toBeTruthy();
  });

  it('follow-up: a section whose review no longer counts asks again — „Hier weiter“ and the earlier review with its date', () => {
    const stale = [summary('journal', { reviewedBefore: { names: ['Klara Prüf'], at: '2026-02-18T10:00:00.000Z' } }), summary('reconciliation', { reviewedBy: ['Klara Prüf'], reviewedByMe: true })];
    wrap(<PackageTable yearId="y25" sections={stale} auditorView />);
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]!).getAllByRole('link', { name: m('finance.audit.package.here') })).toHaveLength(2);
    expect(within(rows[0]!).getByText(/18\.02\.2026/)).toBeTruthy();
  });

  it('auditor: no „Hier weiter“ once the audit of the year is done', () => {
    wrap(<PackageTable yearId="y25" sections={sections()} auditorView auditDone />);
    expect(screen.queryByRole('link', { name: m('finance.audit.package.here') })).toBeNull();
  });

  it('treasurer: progress without „Hier weiter“', () => {
    wrap(<PackageTable yearId="y25" sections={sections()} auditorView={false} />);
    expect(screen.queryByRole('link', { name: m('finance.audit.package.here') })).toBeNull();
    expect(screen.getAllByRole('row')[1]!.textContent).toContain('24');
  });
});

const tableProps = { yearId: 'y25', designation: '2025', section: 'journal' as const, auditorView: true, accounts: [], filters: { text: '', sample: '', account: '', ids: '' }, total: 2, unfiltered: 2, offset: 0 };

describe('SectionTable (Board 4b, N4)', () => {
  it('auditor: a checkbox per entry at the place of `select`, saved at once; a refusal goes to the toast and the box flips back', async () => {
    actions.setSampleAction.mockResolvedValueOnce({ status: 'success', data: { state: 'sampled' } }).mockResolvedValueOnce({ status: 'error', message: 'Nur Prüfer.', fieldErrors: {} });
    wrap(<SectionTable {...tableProps} rows={[entry('1'), entry('2', { sample: 'recheck' })]} />);
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    expect(boxes[1]!.getAttribute('aria-checked')).toBe('false');
    expect(within(screen.getByRole('table')).getByText(m('finance.audit.section.recheck'))).toBeTruthy();
    fireEvent.click(boxes[0]!);
    await waitFor(() => expect(actions.setSampleAction).toHaveBeenCalledWith({ fiscalYearId: 'y25', entryId: '1', sampled: true }));
    await waitFor(() => expect(boxes[0]!.getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(boxes[1]!);
    await waitFor(() => expect(toastRefusal).toHaveBeenCalledWith(expect.objectContaining({ message: 'Nur Prüfer.' })));
    await waitFor(() => expect(boxes[1]!.getAttribute('aria-checked')).toBe('false'));
  });

  it('treasurer: no checkbox; the entry opens from the audit with the way back', () => {
    wrap(<SectionTable {...tableProps} auditorView={false} rows={[entry('1', { remarksOpen: 2 })]} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByRole('link', { name: /2025-1/ }).getAttribute('href')).toBe('/finance/entries/1?from=audit&section=journal&year=y25');
    expect(screen.getByText(/2 Vermerke offen/)).toBeTruthy();
  });

  // Designer Runde 8, 286: Für jede Art steht ein Satz, nie der Schlüssel („priorYearCarryOver“) — über alle Arten des Dienstes.
  it('names every anomaly kind in words, never by its key', () => {
    const rows = ANOMALY_KINDS.map((kind, i) => ({ ...entry(String(i)), key: `${kind}:${i}`, kind, labelParams: { number: `2025-${i}`, year: '2024', change: 'new', reversedNumber: '2025-9', entryYear: '2025', finalizedOn: '2025-06-20', days: 3, documentNumber: 'KZ-1', accountName: 'Kasse', from: '2025-01-01', paymentNumber: 'PZ-1', reasons: 'retroactive', uses: '2', byUserId: 'u1', userId: 'u1', contactName: 'Kim', role: 'board' } }));
    wrap(<SectionTable {...tableProps} section="anomalies" rows={rows} />);
    const text = document.body.textContent ?? '';
    for (const kind of ANOMALY_KINDS) expect(text, kind).not.toContain(kind);
  });

  it('anomalies are grouped by kind', () => {
    const anomaly = (kind: string, id: string) => ({ ...entry(id), key: `${kind}:${id}`, kind });
    wrap(<SectionTable {...tableProps} section="anomalies" rows={[anomaly('cashPayout', '1'), anomaly('cashPayout', '2'), anomaly('roundAmount', '3')]} />);
    expect(screen.getAllByTestId('anomaly-group').map((g) => g.textContent)).toEqual([m('finance.audit.section.anomalyKind.cashPayout'), m('finance.audit.section.anomalyKind.roundAmount')]);
  });
});

describe('ReviewBar (Board 4b, Plan D1d Task 1)', () => {
  it('follow-up: the earlier review stays visible and the button marks the section again', async () => {
    actions.markReviewedAction.mockResolvedValueOnce({ status: 'success' });
    wrap(<ReviewBar yearId="y25" section="journal" auditorView reviewedByMeAt={null} others={[]} reviewedBefore={{ names: ['Klara Prüf'], at: '2026-02-18T10:00:00.000Z' }} next={null} />);
    expect(screen.getByText(/Klara Prüf/)).toBeTruthy();
    const button = screen.getByTestId('audit-section-review');
    expect(button.textContent).toBe(m('finance.audit.section.reviewed'));
    fireEvent.click(button);
    await waitFor(() => expect(actions.markReviewedAction).toHaveBeenCalledWith('y25', 'journal'));
  });
});

describe('PackageRunCard (Plan D1d Task 2)', () => {
  it('refreshes the page once the run has ended, so the files show up elsewhere too', async () => {
    const idle = { state: 'idle' as const, runId: null, cancellable: false, steps: [], finishedAt: null, files: [], skipped: {}, canStart: true };
    actions.startPackageRunAction.mockResolvedValueOnce({ status: 'success' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...idle, state: 'success', runId: 'r1', finishedAt: '2026-02-18T10:00:00.000Z', files: ['reports'] }) });
    vi.stubGlobal('fetch', fetchMock);
    try {
      wrap(<PackageRunCard yearId="y25" initial={idle} />);
      fireEvent.click(screen.getByTestId('package-run-start'));
      // Die erste Abfrage kommt nach einer Sekunde (`pollTextStatus`, App-B4).
      await waitFor(() => expect(refresh).toHaveBeenCalled(), { timeout: 3000 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('shows auditors the files without starting or cancelling (Befund 11 a: the board starts)', () => {
    const done = { state: 'success' as const, runId: 'r1', cancellable: false, steps: [], finishedAt: '2026-02-18T10:00:00.000Z', files: ['reports' as const], skipped: {}, canStart: false };
    wrap(<PackageRunCard yearId="y25" initial={done} />);
    expect(screen.queryByTestId('package-run-start')).toBeNull();
    expect(screen.getByRole('button', { name: m('finance.audit.package.run.files.reports') })).toBeTruthy();
    cleanup();
    wrap(<PackageRunCard yearId="y25" initial={{ ...done, state: 'running', cancellable: true, files: [] }} />);
    expect(screen.queryByRole('button', { name: m('finance.audit.package.run.cancel') })).toBeNull();
  });
});

describe('Abschnitt 9 „Beschlüsse“ (G-30, Designer 2026-10-29)', () => {
  const resolution = (id: string, labelParams: Record<string, string | number | boolean | null>, over: Partial<AuditSectionRow> = {}): AuditSectionRow => ({
    key: `resolution:${id}`, kind: 'resolution', resolutionId: id, date: '2025-03-14', amountCents: typeof labelParams.amountCents === 'number' ? labelParams.amountCents : null,
    labelParams: { number: `B-2025-00${id}`, outcome: 'adopted', organ: 'Mitgliederversammlung', viaCircular: false, minutesDocumentId: null, minutesNumber: null, ...labelParams }, remarksOpen: 0, ...over,
  });
  const writer = { fiscalYearId: 'y25', me: 'Mira Klein', paperAuditors: [], treasurerName: null };
  const props = { ...tableProps, section: 'resolutions' as const };
  const cells = (row: HTMLElement) => Object.fromEntries(within(row).getAllByRole('cell').map((c, i) => [i, c]));

  it('one row per resolution: the details in fixed order with missing ones left out, rejected as a mark, the minutes as a link into the viewer', () => {
    wrap(
      <SectionTable
        {...props}
        rows={[
          resolution('1', { resolutionKind: 'reserve', amountCents: 500000, reserveType: 'nr1', reserveAction: 'create', minutesDocumentId: 'D1', minutesNumber: 'PRT-2025-012' }),
          resolution('2', { resolutionKind: 'remuneration', amountCents: 84000, remunerationMode: 'flat', validFrom: '2025-01-01', outcome: 'rejected', viaCircular: true }),
        ]}
        resolution={{ minutesHrefs: { '1': '/finance/audit/year/y25/resolutions/1/minutes' }, writer: null }}
      />,
    );
    const [first, second] = screen.getAllByRole('row').slice(1);
    // Angaben: Betrag zuerst, „Bildung“ fällt weg; ohne Organe kein leerer Platz in der Kette.
    expect(within(first!).getByText((t) => t.startsWith('5.000,00') && t.split(' · ').length === 2)).toBeTruthy();
    expect(within(second!).getByText((t) => t.includes('840,00') && t.split(' · ').length === 2)).toBeTruthy();
    // Kein Link auf den Beschluss; das Protokoll öffnet in einem neuen Fenster.
    const minutes = within(first!).getByRole('link');
    expect(minutes.getAttribute('href')).toBe('/finance/audit/year/y25/resolutions/1/minutes');
    expect(minutes.getAttribute('target')).toBe('_blank');
    expect(within(second!).queryByRole('link')).toBeNull();
    // „angenommen“ ohne Marke, „abgelehnt“ als Marke in der Statusspalte.
    const status = (row: HTMLElement) => Object.values(cells(row)).find((c) => c.getAttribute('data-col') === 'status')!;
    expect(status(first!).textContent).toBe('');
    expect(status(second!).textContent).toBe(m('finance.audit.section.resolution.outcome.rejected'));
  });

  it('the auditor writes a remark at the row; once one is there, its state stands instead', () => {
    wrap(<SectionTable {...props} rows={[resolution('1', { resolutionKind: 'accounts', fiscalYear: '2025' }), resolution('2', { resolutionKind: 'accounts', fiscalYear: '2025' }, { remarksOpen: 1 })]} resolution={{ minutesHrefs: {}, writer }} />);
    const [first, second] = screen.getAllByRole('row').slice(1);
    expect(within(first!).getByTestId('remark-write')).toBeTruthy();
    expect(within(second!).queryByTestId('remark-write')).toBeNull();
    expect(within(second!).getByText(/Vermerk offen/)).toBeTruthy();
  });

  it('summary: count and rejected ones for the progress column', () => {
    expect(summarizeSection('resolutions', [resolution('1', { resolutionKind: 'accounts' }), resolution('2', { resolutionKind: 'discharge', outcome: 'rejected' })], { samples: 0 }).counts).toEqual({ total: 2, rejected: 1 });
    expect(summarizeSection('resolutions', [], { samples: 0 }).counts).toEqual({ total: 0, rejected: 0 });
  });
});
