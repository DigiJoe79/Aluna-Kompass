// @vitest-environment jsdom
import { CLOSING_STEPS, type ClosingStatus, type ClosingStepFacts, type ClosingStepView } from '@kompass/module-finance';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

const finalizeReportAction = vi.fn(async () => ({ status: 'success' as const }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }), usePathname: () => '/finance/closing', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/app/(shell)/finance/closing/actions', () => ({ confirmStepAction: vi.fn(), confirmAccountAction: vi.fn(), closeYearAction: vi.fn(), reopenYearAction: vi.fn() }));
vi.mock('@/app/(shell)/finance/reports/actions', () => ({ finalizeReportAction, releaseYearAction: vi.fn(), uploadAuditReportAction: vi.fn() }));
const { ClosingSteps } = await import('@/app/(shell)/finance/closing/closing-steps');

afterEach(cleanup);
beforeEach(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  finalizeReportAction.mockClear();
});

/** Schritt 13 „Mittelverwendung festschreiben“ (Plan U2 Task 4): Körper, Festschreiben, Ergebnis — Verhalten, nicht Wortlaut. */
const m = (path: string) => path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], messages) as string;
const wrap = (node: ReactNode) => render(<NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">{node}</NextIntlClientProvider>);

type FundsUseFacts = Extract<ClosingStepFacts, { key: 'fundsUse' }>;
const FUNDS: FundsUseFacts = { key: 'fundsUse', revenueCents: 12_840_000, limitCents: 10_000_000, stage: 'review', finalVersion: null, shortHash: '7c1e09a', finalizeBlock: null };

/** Fakten der Schritte 1–12 wie in `finance-closing-page.test.tsx`. */
const OTHER: Record<string, ClosingStepFacts> = {
  statements: { key: 'statements', accounts: [], accountsWithoutImport: 0, openTransactions: 0 },
  cash: { key: 'cash', accounts: [{ accountId: 'c1', name: 'Barkasse', count: { countId: 'k1', countedOn: '2025-12-31', countedCents: 21430, differenceCents: 0 }, later: null, confirmation: null }] },
  lists: { key: 'lists', undocumentedUnjustified: 0, undocumentedJustified: 0, drafts: 0, vouchersWithoutEntry: 2, foreignMoneyOpen: 0 },
  openItems: { key: 'openItems', receivables: { count: 2, cents: 12000 }, payables: { count: 0, cents: 0 } },
  purposes: { key: 'purposes', closedInYear: 3, openWithBalance: 1, restCents: 216000, negative: 0 },
  reserves: { key: 'reserves', reserves: [{ reserveId: 'r1', name: 'Betriebsmittelrücklage', openingCents: 300000, closingCents: 300000, hasResolution: true }, { reserveId: 'r2', name: 'Zweckrücklage Dach', openingCents: 500000, closingCents: 700000, hasResolution: false }] },
  confirmations: { key: 'confirmations', uncertified: 4, toCorrect: 1, toCorrectNumbers: ['ZWB-2025-014'] },
  close: { key: 'close', closedAt: null, preview: { draftsInPeriod: [], undocumented: [], openTransactionsInPeriod: [], accountsWithoutStatement: [], previousYearOpen: false, pendingCorrections: 0, canClose: true } },
  auditPackage: { key: 'auditPackage', auditors: [], packageRun: 'none', skippedBy: null, package: null },
  auditReport: { key: 'auditReport', release: null, filedAt: null, followUpOpen: false, changedEntries: 0, baselineAt: null, afterAssembly: false, followUpReportId: null, followUpReadyToSign: false, assemblyReports: { done: 0, total: 3 }, statementsMissing: [], carryOver: null },
  assembly: { key: 'assembly', result: null, pending: [], formerlyManaged: null },
  taxReturn: { key: 'taxReturn', vat: null, period: null },
  fundsUse: { key: 'fundsUse', revenueCents: 12_000_000, limitCents: 10_000_000, stage: 'review', finalVersion: null, shortHash: '7c1e09a', finalizeBlock: null },
};

/** Schritte 1–12 erledigt (ihre Fakten spielen keine Rolle), Schritt 13 nach `facts`; ohne `facts` kein Schritt 13. */
function status(facts: FundsUseFacts | null): ClosingStatus {
  const keys = CLOSING_STEPS.filter((k) => facts !== null || k !== 'fundsUse');
  const steps = keys.map((key, i) => ({
    key,
    number: i + 1,
    group: i < 7 ? 'before' : i === 7 ? 'close' : 'after',
    done: key !== 'fundsUse' || facts?.stage === 'final',
    confirmable: false,
    confirmation: null,
    facts: (key === 'fundsUse' ? facts : OTHER[key]) as ClosingStepFacts,
  })) as ClosingStepView[];
  const done = steps.filter((s) => s.done).length;
  return {
    fiscalYearId: 'y25',
    designation: '2025',
    startsOn: '2025-01-01',
    endsOn: '2025-12-31',
    ended: true,
    yearStatus: 'closed',
    doneCount: done,
    next: steps.find((s) => !s.done)?.key ?? null,
    reopened: null,
    toRepeat: [],
    handovers: [],
    steps,
    me: { canConfirm: true, canClose: true, canHandover: true, canCount: true, canRunConfirmations: true },
  } as unknown as ClosingStatus;
}
const FINALIZE = () => m('finance.closing.fundsUse.finalize');

describe('Schritt 13 Mittelverwendung (Plan U2 Task 4)', () => {
  it('active: the body links to the page of the year; with the right and stage review „Festschreiben …“ finalizes this report', async () => {
    wrap(<ClosingSteps status={status(FUNDS)} names={{}} canFinalize />);
    const body = screen.getByTestId('closing-body-fundsUse');
    expect(within(body).getByRole('link', { name: m('finance.closing.fundsUse.toPage') }).getAttribute('href')).toBe('/finance/fund-use?year=y25');
    fireEvent.click(within(body).getByRole('button', { name: FINALIZE() }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: m('finance.reports.view.finalize') }));
    await waitFor(() => expect(finalizeReportAction).toHaveBeenCalledWith('fundsUse', { fiscalYearId: 'y25' }));
  });

  it('without the right or before the review stage: no finalize button', () => {
    wrap(<ClosingSteps status={status(FUNDS)} names={{}} canFinalize={false} />);
    expect(screen.queryByRole('button', { name: FINALIZE() })).toBeNull();
    cleanup();
    wrap(<ClosingSteps status={status({ ...FUNDS, stage: 'preliminary' })} names={{}} canFinalize />);
    expect(screen.queryByRole('button', { name: FINALIZE() })).toBeNull();
  });

  it('finalizing blocked (statement missing): the reason instead of the button', () => {
    wrap(<ClosingSteps status={status({ ...FUNDS, finalizeBlock: { code: 'reportStatementsMissing', params: { accounts: 'Girokonto', count: 1 } } })} names={{}} canFinalize />);
    const body = screen.getByTestId('closing-body-fundsUse');
    expect(within(body).queryByRole('button', { name: FINALIZE() })).toBeNull();
    expect(within(body).getByTestId('closing-funds-use-blocked').textContent).toContain('Girokonto');
  });

  it('done: the result names the number, no body', () => {
    wrap(<ClosingSteps status={status({ ...FUNDS, stage: 'final', finalVersion: { documentNumber: 'MVR-2026-001', finalizedAt: '2026-03-02T10:00:00.000Z' } })} names={{}} canFinalize />);
    expect(screen.queryByTestId('closing-body-fundsUse')).toBeNull();
    expect(document.getElementById('step-fundsUse')!.textContent).toContain('MVR-2026-001');
  });

  it('below the limit the status has twelve steps — the page invents no step 13', () => {
    wrap(<ClosingSteps status={status(null)} names={{}} canFinalize />);
    expect(document.getElementById('step-fundsUse')).toBeNull();
    expect(screen.queryByTestId('closing-body-fundsUse')).toBeNull();
  });
});
