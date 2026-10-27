// @vitest-environment jsdom
import type { TaxReturnGemReport } from '@kompass/module-finance';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/app/(shell)/finance/tax/actions', () => ({}));
vi.mock('@/app/(shell)/finance/reports/actions', () => ({ finalizeReportAction: vi.fn() }));
vi.mock('@/app/(shell)/finance/deadlines/actions', () => ({ createFollowUpAction: vi.fn() }));
vi.mock('@/app/(shell)/finance/donations/notices/actions', () => ({ saveNoticeAction: vi.fn(), attachNoticeDocumentAction: vi.fn() }));
vi.mock('@/app/(shell)/dms/search-action', () => ({ searchDocumentsAction: vi.fn(async () => []) }));
const { TaxEmpty, TaxHeader } = await import('@/app/(shell)/finance/tax/tax-header');
const { FilingSection } = await import('@/app/(shell)/finance/tax/filing-section');
const { GemValuesTable } = await import('@/app/(shell)/finance/tax/gem-values-table');
const { AnswersCard } = await import('@/app/(shell)/finance/tax/answers-card');
const { AttachmentsList } = await import('@/app/(shell)/finance/tax/attachments-list');
const { choosePeriod } = await import('@/app/(shell)/finance/tax/types');
const { TaxPeriodDialog } = await import('@/app/(shell)/finance/tax/tax-period-dialog');
afterEach(cleanup);

const wrap = (node: React.ReactNode) => render(<NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">{node}</NextIntlClientProvider>);
const me = (canEdit: boolean) => ({ canEdit, canFinalize: canEdit, canWriteEntries: canEdit, canPickDocument: false });
const years = [
  { id: 'y24', designation: '2024', startsOn: '2024-01-01', endsOn: '2024-12-31' },
  { id: 'y25', designation: '2025', startsOn: '2025-01-01', endsOn: '2025-12-31' },
];
const period = (over: Record<string, unknown> = {}) => ({ id: 'p1', label: '2024–2025', requestedOn: '2026-01-12', dueOn: '2026-07-31', filedOn: null as string | null, version: 'v1', documents: {}, state: 'open' as const, ...over });

/** Ein Bericht im Zuschnitt des Dienstes: Zeile 10 = nein, fehlende Angaben in 2 und 74. */
const report: TaxReturnGemReport = {
  taxPeriodId: 'p1',
  years: years.map((y) => ({ ...y, short: false })),
  formYear: 2025,
  line10LimitCents: 4_500_000,
  lines: [
    { line: '1', value: { kind: 'yearRange', from: '2024', to: '2025' }, missing: false },
    { line: '2', value: null, missing: true, origin: { kind: 'answer', field: 'churchPurposes' } },
    { line: '9', value: { kind: 'amountPerYear', perYear: [{ line: '9', fiscalYearId: 'y25', cents: 300_00, parts: [] }, { line: '9a', fiscalYearId: 'y24', cents: 200_00, parts: [] }], parts: [] }, missing: false },
    { line: '10', value: { kind: 'yesNo', value: false, cents: 0, limitCents: 4_500_000 }, missing: false },
    { line: '50', value: { kind: 'list', rows: [] }, missing: false },
    { line: '74', value: null, missing: true, origin: { kind: 'answer', field: 'gratuitousBenefits' } },
  ],
  attachments: [],
  hints: [],
  missingCount: 2,
};

describe('Seite Steuererklärung (Rechenschaft D2 Task 9)', () => {
  it('without a period: the empty state offers to create one only with finance.periodClose', () => {
    wrap(<TaxEmpty me={me(true)} years={years} defaults={null} dueSuggestions={{}} />);
    expect(screen.getByTestId('tax-period-create')).toBeTruthy();
    cleanup();
    wrap(<TaxEmpty me={me(false)} years={years} defaults={null} dueSuggestions={{}} />);
    expect(screen.queryByTestId('tax-period-create')).toBeNull();
  });

  it('the notice waits for the filing: no “Ablegen …” before, then it appears', () => {
    wrap(<FilingSection period={period()} notice={null} me={me(true)} />);
    expect(screen.getByTestId('requirement-notice').getAttribute('data-blocked')).toBe('true');
    expect(screen.queryByTestId('tax-file-notice')).toBeNull();
    cleanup();
    wrap(<FilingSection period={period({ filedOn: '2026-05-31', state: 'filed' })} notice={null} me={me(true)} />);
    expect(screen.getByTestId('requirement-notice').getAttribute('data-blocked')).toBe('false');
    expect(screen.getByTestId('tax-file-notice')).toBeTruthy();
  });

  it('readers get neither “Bearbeiten …” nor a save bar', () => {
    wrap(<FilingSection period={period()} notice={null} me={me(false)} />);
    expect(screen.queryByTestId('tax-filing-edit')).toBeNull();
    cleanup();
    wrap(<AnswersCard period={{ id: 'p1', version: 'v1', answers: {} }} formYear={2025} years={years} replacementReserves={[]} participationReserves={[]} memberSuggestions={null} canEdit={false} />);
    expect(screen.queryByTestId('tax-answers-save')).toBeNull();
    cleanup();
    wrap(<AnswersCard period={{ id: 'p1', version: 'v1', answers: {} }} formYear={2025} years={years} replacementReserves={[]} participationReserves={[]} memberSuggestions={null} canEdit />);
    expect(screen.getByTestId('tax-answers-save')).toBeTruthy();
  });

  it('after the filing the answers stand as text with the reason above the card, the member counts too (Befund 18c)', () => {
    wrap(<AnswersCard period={{ id: 'p1', version: 'v1', answers: { statuteDate: '2022-03-01' } }} formYear={2025} years={years} replacementReserves={[]} participationReserves={[]} memberSuggestions={{ y25: 12 }} canEdit filed />);
    expect(screen.queryByTestId('tax-answers-save')).toBeNull();
    expect(screen.getByTestId('tax-answers-filed')).toBeTruthy();
    expect(screen.queryByRole('spinbutton')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    cleanup();
    wrap(<AnswersCard period={{ id: 'p1', version: 'v1', answers: {} }} formYear={2025} years={years} replacementReserves={[]} participationReserves={[]} memberSuggestions={null} canEdit filed={false} />);
    expect(screen.queryByTestId('tax-answers-filed')).toBeNull();
  });

  it('shows one “fehlt” per missing line and no lines 11–24 when line 10 is no', () => {
    wrap(<GemValuesTable data={report} names={{ categories: {}, reserves: {} }} originHrefs={{}} canWriteEntries />);
    expect(screen.getAllByTestId('gem-missing')).toHaveLength(report.missingCount);
    for (const line of ['11', '18', '24']) expect(screen.queryByTestId(`gem-line-${line}`)).toBeNull();
    // Zeile 9 füllt beide Jahre, ältestes zuerst, mit den Zeilennummern in derselben Reihenfolge.
    const nine = screen.getByTestId('gem-line-9').textContent ?? '';
    expect(nine).toContain('9a · 9');
    expect(nine.indexOf('200,00')).toBeLessThan(nine.indexOf('300,00'));
  });

  it('offers “Ablegen …” at the statute like at the activity report, and links the document once it lies there (Befund 18b)', () => {
    const attachments = [{ key: 'activityReport' as const, state: 'missing' as const }, { key: 'statute' as const, state: 'missing' as const }];
    wrap(<AttachmentsList attachments={attachments} periodId="p1" designations={{}} documents={{}} me={me(true)} />);
    expect(screen.getByTestId('tax-file-activityReport')).toBeTruthy();
    expect(screen.getByTestId('tax-file-statute')).toBeTruthy();
    cleanup();
    wrap(<AttachmentsList attachments={attachments} periodId="p1" designations={{}} documents={{}} me={me(false)} />);
    expect(screen.queryByTestId('tax-file-statute')).toBeNull();
    cleanup();
    wrap(<AttachmentsList attachments={[{ key: 'statute', state: 'present' }]} periodId="p1" designations={{}} documents={{ statute: { documentId: 'd1', documentNumber: 'ST-2026-0001' } }} me={me(true)} />);
    expect(screen.queryByTestId('tax-file-statute')).toBeNull();
    expect(screen.getByRole('link', { name: 'ST-2026-0001' }).getAttribute('href')).toBe('/dms/d1');
  });

  it('links the reserve statement over the period by its period, not by its last year (Befund 18d)', () => {
    wrap(<AttachmentsList attachments={[{ key: 'reserveStatement', params: { fiscalYearIds: ['y24', 'y25'] }, state: 'final' }]} periodId="p1" designations={{}} documents={{}} me={me(true)} />);
    expect(screen.getByTestId('tax-attachment-reserveStatement-link').getAttribute('href')).toBe('/finance/reports/reserveStatement?period=p1');
  });

  it('marks the header with its ⋯ as tax-header — the screenshot run waits for it', () => {
    wrap(
      <TaxHeader
        period={{ ...period(), firstFiscalYearId: 'y24', lastFiscalYearId: 'y25', withTaxAdvisor: false, yearsLocked: false }}
        stage="preliminary"
        shortHash="abc1234"
        generatedAt="2026-10-25T10:00:00Z"
        finalizeBlock={null}
        missingCount={2}
        me={me(true)}
        pdfHref="/finance/reports/taxReturnGem/preview?period=p1"
        years={years}
        defaults={null}
        dueSuggestions={{}}
      />,
    );
    const header = screen.getByTestId('tax-header');
    expect(header.querySelector('h1')?.textContent).toContain('2024–2025');
    expect(header.querySelector('[data-testid="tax-record-actions"]')).toBeTruthy();
  });

  it('offers “Festschreiben” only without a block — in the running year and with missing answers the reason stands instead (Befund 23a)', () => {
    const header = (finalizeBlock: { code: string; params: Record<string, unknown> } | null, runningYear: string | null = null) =>
      wrap(
        <TaxHeader
          period={{ ...period(), firstFiscalYearId: 'y24', lastFiscalYearId: 'y25', withTaxAdvisor: false, yearsLocked: false }}
          stage="preliminary"
          shortHash="abc1234"
          generatedAt="2026-10-25T10:00:00Z"
          finalizeBlock={finalizeBlock as never}
          missingCount={finalizeBlock ? 2 : 0}
          me={me(true)}
          pdfHref="/finance/reports/taxReturnGem/preview?period=p1"
          runningYear={runningYear}
          years={years}
          defaults={null}
          dueSuggestions={{}}
        />,
      );
    const running = messages.finance.reports.view.running.replace('{year}', '2025');
    header({ code: 'reportYearOpen', params: { designation: '2025' } }, '2025');
    expect(screen.queryByTestId('tax-finalize')).toBeNull();
    expect(screen.getByTestId('tax-header').textContent).toContain(running);
    cleanup();
    header({ code: 'reportGemIncomplete', params: { missing: 2 } });
    expect(screen.queryByTestId('tax-finalize')).toBeNull();
    expect(screen.getByTestId('tax-finalize-blocked')).toBeTruthy();
    cleanup();
    header(null);
    expect(screen.getByTestId('tax-finalize')).toBeTruthy();
    expect(screen.queryByTestId('tax-finalize-blocked')).toBeNull();
  });

  it('the new-period dialog takes the suggestion, and without a following year leaves Von and Bis empty with the reason (Befund 23d)', () => {
    const dialog = (defaults: { firstFiscalYearId: string; lastFiscalYearId: string } | null) =>
      wrap(<TaxPeriodDialog open onOpenChange={() => {}} period={null} years={years} defaults={defaults} latestPeriod="2025" dueSuggestions={{}} canPickDocument={false} />);
    const value = (id: string) => (document.getElementById(id) as HTMLSelectElement).value;
    dialog({ firstFiscalYearId: 'y24', lastFiscalYearId: 'y25' });
    expect([value('tax-period-first'), value('tax-period-last')]).toEqual(['y24', 'y25']);
    expect(screen.queryByTestId('tax-period-no-years')).toBeNull();
    cleanup();
    dialog(null);
    expect([value('tax-period-first'), value('tax-period-last')]).toEqual(['', '']);
    expect(screen.getByTestId('tax-period-no-years').textContent).toContain('2025');
  });

  it('picks the newest open period unless the address names one', () => {
    const periods = [{ id: 'a', state: 'filed' }, { id: 'b', state: 'open' }, { id: 'c', state: 'open' }];
    expect(choosePeriod(periods, undefined)?.id).toBe('b');
    expect(choosePeriod(periods, 'c')?.id).toBe('c');
    expect(choosePeriod(periods, 'x')?.id).toBe('b');
    expect(choosePeriod([{ id: 'a', state: 'assessed' }], undefined)?.id).toBe('a');
    expect(choosePeriod([], undefined)).toBeNull();
  });
});

describe('Herkunft der Werte (Designer Runde 7, 16c)', () => {
  it('is always a link; without a target „—“', async () => {
    const { originNode } = await import('@/app/(shell)/finance/tax/gem-values-table');
    render(<NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin"><p data-testid="a">{originNode('/finance/reports/x', 'EÜR für das Finanzamt')}</p><p data-testid="b">{originNode(null, 'Buchungen im Zweckbetrieb')}</p></NextIntlClientProvider>);
    expect(screen.getByTestId('a').querySelector('a')?.getAttribute('href')).toBe('/finance/reports/x');
    expect(screen.getByTestId('b').querySelector('a')).toBeNull();
    expect(screen.getByTestId('b').textContent).toContain('—');
  });
});
