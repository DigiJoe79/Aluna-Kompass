// @vitest-environment jsdom
import { CLOSING_STEPS, type ClosingStatus, type ClosingStepFacts, type ClosingStepKey, type ClosingStepView } from '@kompass/module-finance';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { defaultClosingYearId } from '@/lib/finance/closing-year';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }), usePathname: () => '/finance/closing', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/app/(shell)/finance/closing/actions', () => ({ confirmStepAction: vi.fn(async () => ({ status: 'success' })), confirmAccountAction: vi.fn(async () => ({ status: 'success' })), closeYearAction: vi.fn(async () => ({ status: 'success' })), reopenYearAction: vi.fn(async () => ({ status: 'success' })) }));
const { ClosingHeader } = await import('@/app/(shell)/finance/closing/closing-header');
const { ClosingSteps } = await import('@/app/(shell)/finance/closing/closing-steps');
const { confirmStepAction, confirmAccountAction } = await import('@/app/(shell)/finance/closing/actions');

afterEach(cleanup);
beforeEach(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  vi.mocked(confirmStepAction).mockClear();
});

/**
 * Seite Jahresabschluss (Plan C2 Task 3, Board 3a–3c, 10a): Kopf, Gruppen, Zustände, Körper der Schritte 2–8 und 12,
 * Bestätigen-Dialog, Rechte. Der Stand kommt als Props; geprüft wird Verhalten, nicht Wortlaut.
 */
const m = (path: string) => path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], messages) as string;
const wrap = (node: ReactNode) => render(<NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">{node}</NextIntlClientProvider>);

const FACTS: { [K in ClosingStepKey]: Extract<ClosingStepFacts, { key: K }> } = {
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
/** Die zwölf festen Schritte; Schritt 13 (Mittelverwendung) nur über der Grenze, sein Körper kommt mit U2. */
const TWELVE = CLOSING_STEPS.filter((key) => key !== 'fundsUse');
const CONFIRMABLE = new Set(['statements', 'lists', 'openItems', 'purposes', 'reserves', 'confirmations', 'taxReturn']);

function status(over: { done?: number; next?: ClosingStepKey | null; ended?: boolean; yearStatus?: 'open' | 'closed'; me?: Partial<ClosingStatus['me']>; facts?: Partial<typeof FACTS>; reopened?: ClosingStatus['reopened']; toRepeat?: ClosingStepKey[]; handovers?: ClosingStatus['handovers']; confirmations?: Partial<Record<ClosingStepKey, ClosingStepView['confirmation']>>; confirmable?: Partial<Record<ClosingStepKey, boolean>> } = {}): ClosingStatus {
  const done = over.done ?? 5;
  const steps: ClosingStepView[] = TWELVE.map((key, i) => ({
    key,
    number: i + 1,
    group: i < 7 ? 'before' : i === 7 ? 'close' : 'after',
    done: i < done,
    confirmable: over.confirmable?.[key] ?? CONFIRMABLE.has(key),
    confirmation: over.confirmations?.[key] ?? null,
    facts: (over.facts?.[key] ?? FACTS[key]) as ClosingStepFacts,
  }));
  return {
    fiscalYearId: 'y25',
    designation: '2025',
    startsOn: '2025-01-01',
    endsOn: '2025-12-31',
    ended: over.ended ?? true,
    yearStatus: over.yearStatus ?? 'open',
    doneCount: done,
    next: over.next !== undefined ? over.next : (TWELVE[done] ?? null),
    reopened: over.reopened ?? null,
    toRepeat: over.toRepeat ?? [],
    handovers: over.handovers ?? [],
    steps,
    me: { canConfirm: true, canClose: true, canHandover: true, canCount: true, canRunConfirmations: true, ...over.me },
  };
}
const NAMES = { u1: 'Anna Berger' };

describe('Vorgabe des Jahres', () => {
  const years = [
    { id: 'y26', endsOn: '2026-12-31' },
    { id: 'y25', endsOn: '2025-12-31' },
    { id: 'y24', endsOn: '2024-12-31' },
  ];
  it('das jüngste beendete Jahr, das nicht fertig ist; sonst das jüngste beendete; sonst das laufende', async () => {
    expect(await defaultClosingYearId(years, '2026-03-01', async () => false)).toBe('y25');
    expect(await defaultClosingYearId(years, '2026-03-01', async (id) => id === 'y25')).toBe('y24');
    expect(await defaultClosingYearId(years, '2026-03-01', async () => true)).toBe('y25');
    expect(await defaultClosingYearId([{ id: 'y26', endsOn: '2026-12-31' }], '2026-03-01', async () => false)).toBe('y26');
    expect(await defaultClosingYearId([], '2026-03-01', async () => false)).toBeNull();
  });
});

describe('Kopf', () => {
  it('Titel mit Jahr, Stand mit Zahl und nächstem Schritt', () => {
    wrap(<ClosingHeader status={status({ done: 5 })} reopen={null} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('2025');
    const head = screen.getByTestId('closing-head').textContent!;
    expect(head).toContain('5');
    expect(head).toContain('12');
    expect(head).toContain(m('finance.closing.steps.reserves.next'));
  });

  it('offene Nachprüfung: „Als Nächstes“ nennt die Nachprüfung, nicht das Festschreiben', () => {
    const followUp = { ...FACTS.auditReport, followUpOpen: true, changedEntries: 0 };
    wrap(<ClosingHeader status={status({ done: 9, facts: { auditReport: followUp } })} reopen={null} />);
    const head = screen.getByTestId('closing-head').textContent!;
    expect(head).toContain(m('finance.closing.steps.auditReport.nextFollowUp'));
    expect(head).not.toContain(m('finance.closing.steps.auditReport.next'));
  });

  it('„Als Nächstes“ nennt die USt-Jahreserklärung, wenn nur sie fehlt (E11)', () => {
    const vat = { calendarYear: 2025, dueOn: '2026-07-31', filedOn: null, reason: 'section18_4a' as const, overdue: false };
    const filed = { id: 'p1', label: '2023–2025', dueOn: '2026-07-31', filedOn: '2026-05-12', lastYear: true, last: '2025', overdue: false, notice: null };
    wrap(<ClosingHeader status={status({ done: 11, facts: { taxReturn: { key: 'taxReturn', vat, period: filed } } })} reopen={null} />);
    const head = screen.getByTestId('closing-head').textContent!;
    expect(head).toContain('Als Nächstes: Umsatzsteuer-Jahreserklärung 2025 abgeben');
    expect(head).not.toContain(m('finance.closing.steps.taxReturn.next'));
  });

  it('Nachprüfung ohne geänderte Buchung (14d B): Dialog ohne Begründung, bestätigt ohne Text', async () => {
    const followUp = { ...FACTS.auditReport, followUpOpen: true, changedEntries: 0, filedAt: '2026-02-20T10:00:00Z' };
    wrap(<ClosingSteps status={status({ done: 9, facts: { auditReport: followUp }, confirmable: { auditReport: true } })} names={NAMES} />);
    fireEvent.click(within(screen.getByTestId('closing-body-auditReport')).getByRole('button', { name: m('finance.closing.confirm') }));
    const dialog = await screen.findByTestId('closing-confirm-dialog');
    expect(within(dialog).queryByRole('textbox')).toBeNull();
    expect(dialog.textContent).toContain('20.02.2026');
    fireEvent.click(within(dialog).getByRole('button', { name: m('finance.closing.confirmDialog.save') }));
    await waitFor(() => expect(confirmStepAction).toHaveBeenCalledWith('y25', 'auditReport', null));
  });

  it('Schritt 12 mit Erklärungszeitraum (15h): der Weg zur Steuererklärung statt „Bestätigen …“, je Zustand der Satz', () => {
    const period = { id: 'p1', label: '2024–2025', dueOn: '2026-07-31', filedOn: null, lastYear: true, last: '2025', overdue: false, notice: null };
    // Ohne Zeitraum: bestätigbar, daneben der Weg zur Steuererklärung.
    wrap(<ClosingSteps status={status({ done: 11 })} names={NAMES} />);
    expect(within(screen.getByTestId('closing-body-taxReturn')).getByRole('button', { name: m('finance.closing.confirm') })).toBeTruthy();
    expect(screen.getByTestId('closing-to-tax').getAttribute('href')).toBe('/finance/tax');
    cleanup();
    // Letztes Jahr eines offenen Zeitraums: nur der Weg, kein „Bestätigen …“; überfällig mit Marke.
    wrap(<ClosingSteps status={status({ done: 11, facts: { taxReturn: { key: 'taxReturn', vat: null, period: { ...period, overdue: true } } }, confirmable: { taxReturn: false } })} names={NAMES} />);
    const body = screen.getByTestId('closing-body-taxReturn');
    expect(within(body).queryByRole('button', { name: m('finance.closing.confirm') })).toBeNull();
    expect(screen.getByTestId('closing-to-tax').getAttribute('href')).toBe('/finance/tax?period=p1');
    expect(body.textContent).toContain(m('finance.closing.taxReturn.overdue'));
    cleanup();
    // Erledigt: Teil eines offenen Zeitraums, abgegeben, mit Bescheid — der Zeitraum verlinkt die Steuererklärung.
    for (const p of [{ ...period, lastYear: false }, { ...period, filedOn: '2026-05-12' }, { ...period, filedOn: '2026-05-12', notice: { noticeOn: '2026-09-03', documentId: 'd1' } }]) {
      wrap(<ClosingSteps status={status({ done: 12, next: null, facts: { taxReturn: { key: 'taxReturn', vat: null, period: p } } })} names={NAMES} />);
      fireEvent.click(screen.getByRole('button', { name: m('finance.closing.showSteps') }));
      expect(screen.getByTestId('closing-tax-period').getAttribute('href')).toBe('/finance/tax?period=p1');
      expect(screen.queryByTestId('closing-body-taxReturn')).toBeNull();
      cleanup();
    }
  });

  it('Schritt 12 nennt die USt-Jahreserklärung mit Grund und Link zu den Fristen (Board Umsatzsteuer 6a)', () => {
    const vat = { calendarYear: 2026, dueOn: '2027-08-02', filedOn: null, reason: 'section18_4a' as const, overdue: false };
    wrap(<ClosingSteps status={status({ done: 11, facts: { taxReturn: { key: 'taxReturn', vat, period: null } } })} names={NAMES} />);
    const body = screen.getByTestId('closing-body-taxReturn');
    expect(within(body).getByRole('link', { name: m('finance.closing.taxReturn.toDeadlines') }).getAttribute('href')).toBe('/finance/deadlines');
    cleanup();
    wrap(<ClosingSteps status={status({ done: 11 })} names={NAMES} />);
    expect(within(screen.getByTestId('closing-body-taxReturn')).queryByRole('link', { name: m('finance.closing.taxReturn.toDeadlines') })).toBeNull();
  });

  it('Schritt 12 offen nur wegen der USt-Jahreserklärung (Befund 34 a): oben das Ergebnis der Steuererklärung, im Körper nur, was fehlt', () => {
    const vat = { calendarYear: 2025, dueOn: '2026-07-31', filedOn: null, reason: 'section18_4a' as const, overdue: false };
    const filed = { id: 'p1', label: '2023–2025', dueOn: '2026-07-31', filedOn: '2026-05-12', lastYear: true, last: '2025', overdue: false, notice: null };
    wrap(<ClosingSteps status={status({ done: 11, facts: { taxReturn: { key: 'taxReturn', vat, period: filed } } })} names={NAMES} />);
    const body = screen.getByTestId('closing-body-taxReturn');
    expect(within(body).getByRole('link', { name: m('finance.closing.taxReturn.toDeadlines') }).getAttribute('href')).toBe('/finance/deadlines');
    expect(within(body).queryByTestId('closing-to-tax')).toBeNull();
    expect(screen.getByTestId('closing-tax-period').getAttribute('href')).toBe('/finance/tax?period=p1');
    expect(body.textContent).toContain('31.07.2026');
    cleanup();
    // Ohne Zeitraum, schon bestätigt: kein zweites „Bestätigen …“, die Bestätigung steht oben.
    wrap(<ClosingSteps status={status({ done: 11, facts: { taxReturn: { key: 'taxReturn', vat, period: null } }, confirmations: { taxReturn: { note: 'nicht angefordert', at: '2026-03-20T10:00:00.000Z', byUserId: 'u1' } } })} names={NAMES} />);
    const confirmed = screen.getByTestId('closing-body-taxReturn');
    expect(within(confirmed).queryByRole('button', { name: m('finance.closing.confirm') })).toBeNull();
    expect(within(confirmed).getByRole('link', { name: m('finance.closing.taxReturn.toDeadlines') })).toBeTruthy();
    expect(screen.getByTestId('closing-confirmed-taxReturn').textContent).toContain('Anna Berger');
  });

  // Designer Runde 8, 17e: verstrichen mit Marke, „Abgabe eintragen …“ im Schritt; fehlen zwei Dinge, stehen sie als Zeilen.
  it('Schritt 12 wartet auf die USt-Jahreserklärung: überfällig, Abgabe im Schritt; zwei offene als Zeilen', () => {
    const vat = { calendarYear: 2025, dueOn: '2026-07-31', filedOn: null, reason: 'section18_4a' as const, overdue: true };
    const filed = { id: 'p1', label: '2023–2025', dueOn: '2026-07-31', filedOn: '2026-05-12', lastYear: true, last: '2025', overdue: false, notice: null };
    wrap(<ClosingSteps status={status({ done: 11, facts: { taxReturn: { key: 'taxReturn', vat, period: filed } } })} names={NAMES} today="2026-10-26" canFileVat />);
    const body = screen.getByTestId('closing-body-taxReturn');
    expect(within(body).getByTestId('closing-tax-vat-overdue')).toBeTruthy();
    expect(within(body).getByTestId('closing-tax-vat-file')).toBeTruthy();
    expect(within(body).queryByTestId('requirement-list')).toBeNull();
    cleanup();
    const due = { ...filed, filedOn: null, overdue: true };
    wrap(<ClosingSteps status={status({ done: 11, facts: { taxReturn: { key: 'taxReturn', vat, period: due } } })} names={NAMES} today="2026-10-26" canFileVat />);
    const rows = within(screen.getByTestId('closing-body-taxReturn')).getAllByRole('listitem');
    expect(rows.map((r) => r.dataset.testid)).toEqual(['requirement-taxReturn', 'requirement-vatReturn']);
    expect(within(rows[1]!).getByTestId('closing-tax-vat-file')).toBeTruthy();
    cleanup();
    // Ohne das Recht kein Knopf, der Weg zu den Fristen bleibt.
    wrap(<ClosingSteps status={status({ done: 11, facts: { taxReturn: { key: 'taxReturn', vat, period: filed } } })} names={NAMES} today="2026-10-26" />);
    expect(within(screen.getByTestId('closing-body-taxReturn')).queryByTestId('closing-tax-vat-file')).toBeNull();
  });

  it('„Fertig.“ nennt auch die abgegebene USt-Jahreserklärung (Befund 34 a)', () => {
    const vat = { calendarYear: 2025, dueOn: '2026-07-31', filedOn: '2026-07-20', reason: 'section18_4a' as const, overdue: false };
    const filed = { id: 'p1', label: '2023–2025', dueOn: '2026-07-31', filedOn: '2026-05-12', lastYear: true, last: '2025', overdue: false, notice: null };
    wrap(<ClosingSteps status={status({ done: 12, next: null, facts: { taxReturn: { key: 'taxReturn', vat, period: filed } } })} names={NAMES} />);
    expect(screen.getByTestId('closing-finished').textContent).toContain('20.07.2026');
  });

  it('„Fertig.“ übernimmt den Stand von Schritt 12 aus derselben Quelle (Designer Runde 7, 294)', async () => {
    const { taxReturnStateOf } = await import('@/app/(shell)/finance/closing/step-detail');
    const period = { id: 'p1', label: '2024–2025', dueOn: '2026-07-31', filedOn: '2026-05-12', lastYear: true, last: '2025', overdue: false, notice: null };
    const cases = [
      [null, 'notDue'],
      [period, 'filed'],
      [{ ...period, notice: { noticeOn: '2026-09-03', documentId: 'd1' } }, 'notice'],
      [{ ...period, filedOn: null, lastYear: false }, 'partOf'],
    ] as const;
    for (const [p, state] of cases) {
      expect(taxReturnStateOf({ key: 'taxReturn', vat: null, period: p })).toBe(state);
      wrap(<ClosingSteps status={status({ done: 12, next: null, facts: { taxReturn: { key: 'taxReturn', vat: null, period: p } } })} names={NAMES} />);
      const finished = document.body.textContent ?? '';
      // Nie „nicht fällig“, wenn Schritt 12 einen Zeitraum kennt; der Zeitraum steht im Satz.
      if (p) {
        expect(finished).not.toContain('nicht fällig');
        expect(finished).toContain('2024–2025');
      } else expect(finished).toContain('nicht fällig');
      cleanup();
    }
  });

  it('Jahr nicht beendet: der Satz nennt das Ende, kein Schritt ist aktiv, kein Körper', () => {
    const s = status({ done: 0, ended: false });
    wrap(
      <>
        <ClosingHeader status={s} reopen={null} />
        <ClosingSteps status={s} names={NAMES} />
      </>,
    );
    expect(screen.getByTestId('closing-head').textContent).toContain('31.12.2025');
    expect(document.querySelector('[aria-current="step"]')).toBeNull();
    expect(screen.queryByRole('button', { name: m('finance.closing.confirm') })).toBeNull();
  });

  it('⋯: Amtsübergabe nur mit dem Recht, Wiederöffnen nur im abgeschlossenen Jahr mit Recht', async () => {
    const onStart = vi.fn();
    wrap(<ClosingHeader status={status({ yearStatus: 'closed' })} reopen={{ consequences: [{ code: 'releaseRevoked', params: {} }], laterYearClosed: false, taxReturnFiledOn: null, taxReturnPeriod: null }} onStartHandover={onStart} />);
    fireEvent.click(screen.getByRole('button', { name: m('common.moreActions') }));
    expect(await screen.findByText(m('finance.closing.more.handover'))).toBeTruthy();
    expect(screen.getByText(m('finance.closing.more.reopen'))).toBeTruthy();
    cleanup();
    wrap(<ClosingHeader status={status({ yearStatus: 'open', me: { canHandover: false } })} reopen={null} onStartHandover={onStart} />);
    expect(screen.queryByRole('button', { name: m('common.moreActions') })).toBeNull();
  });

  it('Wiederöffnen: Folgen als Liste, Begründung Pflicht', async () => {
    wrap(<ClosingHeader status={status({ yearStatus: 'closed' })} reopen={{ consequences: [{ code: 'reportsVoided', params: { count: 2 } }, { code: 'releaseRevoked', params: {} }], laterYearClosed: false, taxReturnFiledOn: null, taxReturnPeriod: null }} />);
    fireEvent.click(screen.getByRole('button', { name: m('common.moreActions') }));
    fireEvent.click(await screen.findByText(m('finance.closing.more.reopen')));
    const dialog = await screen.findByTestId('closing-reopen-dialog');
    expect(within(within(dialog).getByTestId('closing-reopen-consequences')).getAllByRole('listitem')).toHaveLength(2);
    expect(within(dialog).getByLabelText(new RegExp(m('finance.closing.reopenDialog.note'))).hasAttribute('required') || within(dialog).getByText('*')).toBeTruthy();
  });

  it('Wiederöffnen: die abgegebene Erklärung heißt nach ihrem Zeitraum, nicht nach dem Jahr (Befund 34 b)', async () => {
    wrap(<ClosingHeader status={status({ yearStatus: 'closed' })} reopen={{ consequences: [], laterYearClosed: false, taxReturnFiledOn: '31.05.2026', taxReturnPeriod: '2023–2025' }} />);
    fireEvent.click(screen.getByRole('button', { name: m('common.moreActions') }));
    fireEvent.click(await screen.findByText(m('finance.closing.more.reopen')));
    const dialog = await screen.findByTestId('closing-reopen-dialog');
    expect(within(dialog).getByTestId('closing-reopen-consequences').textContent).toContain('Die Steuererklärung für 2023–2025 ist am 31.05.2026 abgegeben');
  });
});

describe('Wiederöffnen abgelehnt', () => {
  // Designer Runde 8, 17f (313): Steht die Ablehnung vorher fest, fragt der Dialog nichts ab.
  it('nur der Satz, der Weg zum späteren Jahr und „Schließen“', async () => {
    wrap(<ClosingHeader status={status({ yearStatus: 'closed' })} reopen={{ consequences: [{ code: 'releaseRevoked', params: {} }], laterYearClosed: true, laterYear: { id: 'y25', designation: '2025' }, taxReturnFiledOn: null, taxReturnPeriod: null }} />);
    fireEvent.click(screen.getByRole('button', { name: m('common.moreActions') }));
    fireEvent.click(await screen.findByText(m('finance.closing.more.reopen')));
    const dialog = await screen.findByTestId('closing-reopen-dialog');
    expect(within(dialog).queryByRole('textbox')).toBeNull();
    expect(within(dialog).queryByTestId('closing-reopen-consequences')).toBeNull();
    expect(within(dialog).queryByRole('button', { name: m('finance.closing.reopenDialog.save') })).toBeNull();
    expect(within(dialog).getByTestId('closing-reopen-later').getAttribute('href')).toBe('/finance/closing?year=y25');
    expect(within(dialog).getByRole('button', { name: m('common.close') })).toBeTruthy();
  });
});

describe('Schritte', () => {
  it('drei Gruppen 7 · 1 · 4, nur der nächste aktiv, erledigte mit Ergebnis', () => {
    wrap(<ClosingSteps status={status({ done: 5 })} names={NAMES} />);
    const lists = screen.getAllByRole('list').filter((l) => l.tagName === 'OL');
    expect(lists.map((l) => within(l).getAllByRole('listitem').filter((li) => li.id.startsWith('step-')).length)).toEqual([7, 1, 4]);
    const states = TWELVE.map((k) => document.getElementById(`step-${k}`)!.getAttribute('data-state'));
    expect(states).toEqual(['done', 'done', 'done', 'done', 'done', 'active', 'todo', 'todo', 'todo', 'todo', 'todo', 'todo']);
    // Erledigt: Kasse mit Betrag als Ergebnis.
    expect(document.getElementById('step-cash')!.textContent).toContain('214,30');
    // Aktiv: nur Schritt 6 trägt einen Körper.
    expect(screen.getByTestId('closing-body-reserves')).toBeTruthy();
    expect(screen.queryByTestId('closing-body-confirmations')).toBeNull();
  });

  it('Stand als Satz (Befund 8): jeder Schritt vor dem Abschluss, offen wie erledigt; der aktive und offene danach ohne', () => {
    const BEFORE = CLOSING_STEPS.slice(0, 7);
    const detail = (key: string) => screen.queryByTestId(`closing-steps-${key}-detail`);
    wrap(<ClosingSteps status={status({ done: 0, ended: false })} names={NAMES} />);
    for (const key of BEFORE) expect(detail(key)?.textContent, key).toBeTruthy();
    for (const key of TWELVE.slice(7)) expect(detail(key), key).toBeNull();
    cleanup();
    wrap(<ClosingSteps status={status({ done: 7 })} names={NAMES} />);
    for (const key of BEFORE) expect(detail(key)?.textContent, key).toBeTruthy();
    // Schritt 1 erledigt ohne Teile: der Ersatzsatz.
    expect(detail('statements')!.textContent).toBe(m('finance.closing.statements.resultAll'));
    expect(detail('close')).toBeNull();
    cleanup();
    wrap(<ClosingSteps status={status({ done: 5 })} names={NAMES} />);
    expect(detail('reserves')).toBeNull();
    expect(detail('confirmations')?.textContent).toBeTruthy();
  });

  it('Stand offener Schritte (284): vor dem Jahresende ohne Stichtag, danach mit; Schritt 1 mit einem Konto nennt es; Schritt 9 mit Tag und Stand', () => {
    const detail = (key: string) => screen.getByTestId(`closing-steps-${key}-detail`).textContent!;
    wrap(<ClosingSteps status={status({ done: 0, ended: false })} names={NAMES} />);
    expect(detail('openItems')).not.toContain('31.12.2025');
    expect(detail('reserves')).not.toContain('31.12.2025');
    cleanup();
    wrap(<ClosingSteps status={status({ done: 1 })} names={NAMES} />);
    expect(detail('openItems')).toContain('31.12.2025');
    cleanup();
    const one = { key: 'statements' as const, accountsWithoutImport: 0, openTransactions: 0, accounts: [{ accountId: 'b', name: 'Vereinskonto', kind: 'bank' as const, needsPdf: false, statement: { documentId: 'd', documentNumber: 'KA-1', periodFrom: null, periodTo: '2025-12-31', covers: true }, lastStatementTo: '2025-12-31', lastMovementOn: null, balanceAtYearEndCents: 0, importedBalance: null, confirmation: null }] };
    wrap(<ClosingSteps status={status({ done: 10, facts: { statements: one, auditPackage: { ...FACTS.auditPackage, packageRun: 'done', package: { at: '2026-02-20T10:00:00Z', shortHash: '52e64e8d' } } } })} names={NAMES} />);
    expect(detail('statements')).toContain('Vereinskonto');
    expect(detail('auditPackage')).toContain('20.02.2026');
    expect(detail('auditPackage')).toContain('52e64e8d');
  });

  it('Bestätigung mit Begründung als Unterzeile des erledigten Schritts', () => {
    wrap(<ClosingSteps status={status({ done: 5, confirmations: { openItems: { note: 'Mahnung läuft.', at: '2026-01-08T10:00:00Z', byUserId: 'u1' } } })} names={NAMES} />);
    const line = screen.getByTestId('closing-confirmed-openItems').textContent!;
    expect(line).toContain('Anna Berger');
    expect(line).toContain('Mahnung läuft.');
  });

  it('Schritt 2 (14a): je Kasse eine Zeile; rückgerechnet „Bestätigen …“ an der Zeile, mit Differenz Marke und Weg zur Kasse', async () => {
    const counted = { accountId: 'c0', name: 'Zählkasse', count: { countId: 'k0', countedOn: '2025-12-31', countedCents: 20000, differenceCents: 0 }, later: null, confirmation: null };
    const later = (differenceCents: number, confirmation: { note: string; at: string; byUserId: string } | null = null) => ({ accountId: 'c1', name: 'Barkasse', count: null, later: { countId: 'k2', countedOn: '2026-01-05', countedCents: 1200, differenceCents, bookCentsAtEnd: 1000 }, confirmation });
    wrap(<ClosingSteps status={status({ done: 1, facts: { cash: { key: 'cash', accounts: [counted, later(0)] } }, confirmable: { cash: false } })} names={NAMES} />);
    const rows = within(screen.getByTestId('closing-body-cash')).getAllByTestId('closing-cash-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).queryByRole('button')).toBeNull();
    expect(rows[1]!.textContent).toContain('10,00');
    fireEvent.click(within(rows[1]!).getByRole('button', { name: m('finance.closing.confirm') }));
    const dialog = await screen.findByTestId('closing-justify-dialog');
    expect(within(dialog).getByRole('heading').textContent).toContain('Barkasse');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Am 31.12. war niemand da.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: m('finance.closing.cash.confirmDialog.save') }));
    await waitFor(() => expect(confirmAccountAction).toHaveBeenCalledWith('y25', 'c1', 'cashRecomputed', 'Am 31.12. war niemand da.'));
    cleanup();
    // Mit Differenz: nichts zu bestätigen, Marke und Link zur Kasse.
    wrap(<ClosingSteps status={status({ done: 1, facts: { cash: { key: 'cash', accounts: [later(100)] } }, confirmable: { cash: false } })} names={NAMES} />);
    const row = screen.getByTestId('closing-cash-row');
    expect(within(row).queryByRole('button')).toBeNull();
    expect(within(row).getByRole('link').getAttribute('href')).toBe('/finance/cash');
    expect(row.textContent).toContain('1,00');
    cleanup();
    // Bestätigt: kein Knopf mehr; erledigt steht die Begründung unter dem Ergebnis.
    wrap(<ClosingSteps status={status({ done: 2, next: 'lists', facts: { cash: { key: 'cash', accounts: [counted, later(0, { note: 'Am 31.12. war niemand da.', at: '2026-01-06T10:00:00Z', byUserId: 'u1' })] } } })} names={NAMES} />);
    const detail = screen.getByTestId('closing-steps-cash-detail').textContent!;
    expect(detail).toContain('Anna Berger');
    expect(detail).toContain('Am 31.12. war niemand da.');
  });

  it('Schritt 6: Rücklagen als Liste, „Beschluss fehlt“ als Text, Bestätigen öffnet den Dialog mit Pflicht-Begründung', async () => {
    wrap(<ClosingSteps status={status({ done: 5 })} names={NAMES} />);
    expect(within(screen.getByTestId('closing-body-reserves')).getAllByTestId('closing-reserve')).toHaveLength(2);
    expect(screen.getByText(m('finance.closing.reserves.noResolution'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: m('finance.closing.confirm') }));
    const dialog = await screen.findByTestId('closing-confirm-dialog');
    expect(within(dialog).getByRole('heading').textContent).toContain('2025');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Beschluss vom 08.12.2025.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: m('finance.closing.confirmDialog.save') }));
    await waitFor(() => expect(confirmStepAction).toHaveBeenCalledWith('y25', 'reserves', 'Beschluss vom 08.12.2025.'));
  });

  it('Schritt 7 (10a): ohne Warnfarbe, bis drei Nummern als Links, „Serienlauf“ als Link', () => {
    wrap(<ClosingSteps status={status({ done: 6 })} names={NAMES} />);
    const body = screen.getByTestId('closing-body-confirmations');
    expect(within(body).queryByRole('status')).toBeNull();
    expect(within(within(body).getByTestId('closing-to-correct')).getByRole('link', { name: 'ZWB-2025-014' })).toBeTruthy();
    expect(within(body).getByRole('link', { name: m('finance.closing.confirmations.run') }).getAttribute('href')).toBe('/finance/donations/run');
    expect(within(body).getByRole('button', { name: m('finance.closing.confirm') })).toBeTruthy();
  });

  it('Schritt 7 mit mehr als drei zu korrigieren: ein Link mit Zahl', () => {
    wrap(<ClosingSteps status={status({ done: 6, facts: { confirmations: { key: 'confirmations', uncertified: 0, toCorrect: 5, toCorrectNumbers: ['A', 'B', 'C'] } } })} names={NAMES} />);
    expect(within(screen.getByTestId('closing-to-correct')).getAllByRole('link')).toHaveLength(1);
  });

  it('Schritt 8: Hemmnisse als Liste mit Links, ohne „Jahr abschließen …“; ohne Hemmnis der Knopf', () => {
    const blocked = status({ done: 7, facts: { close: { key: 'close', closedAt: null, preview: { draftsInPeriod: [{ id: 'e1', entryDate: '2025-05-01' }], undocumented: [], openTransactionsInPeriod: [], accountsWithoutStatement: [], previousYearOpen: false, pendingCorrections: 0, canClose: false } } } });
    wrap(<ClosingSteps status={blocked} names={NAMES} />);
    const body = screen.getByTestId('closing-body-close');
    expect(within(body).getByTestId('requirement-drafts')).toBeTruthy();
    expect(within(body).queryByTestId('closing-close')).toBeNull();
    cleanup();
    wrap(<ClosingSteps status={status({ done: 7 })} names={NAMES} />);
    fireEvent.click(screen.getByTestId('closing-close'));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('Schritt 8: wartende Korrekturen halten den Abschluss nicht auf — sie stehen als Hinweis, der Knopf bleibt', () => {
    wrap(<ClosingSteps status={status({ done: 7, facts: { close: { key: 'close', closedAt: null, preview: { draftsInPeriod: [], undocumented: [], openTransactionsInPeriod: [], accountsWithoutStatement: [], previousYearOpen: false, pendingCorrections: 2, canClose: true } } } })} names={NAMES} />);
    expect(screen.getByTestId('closing-close')).toBeTruthy();
    expect(within(screen.getByTestId('closing-pending-corrections')).getByRole('link').getAttribute('href')).toBe('/finance/approvals');
  });

  it('Schritt 12: Bestätigen öffnet mit dem Vorschlag als Begründung', async () => {
    wrap(<ClosingSteps status={status({ done: 11 })} names={NAMES} />);
    fireEvent.click(screen.getByRole('button', { name: m('finance.closing.confirm') }));
    const dialog = await screen.findByTestId('closing-confirm-dialog');
    expect((within(dialog).getByRole('textbox') as HTMLTextAreaElement).value).toContain('2025');
  });

  it('ohne finance.periodClose: kein Knopf, der Satz, wer bestätigen kann', () => {
    wrap(<ClosingSteps status={status({ done: 5, me: { canConfirm: false, canClose: false, canHandover: false } })} names={NAMES} />);
    expect(screen.queryByRole('button', { name: m('finance.closing.confirm') })).toBeNull();
    expect(screen.getByText(m('finance.closing.noRight'))).toBeTruthy();
  });

  it('Nur-Leser: „Kasse zählen“ und „Serienlauf“ nur mit dem Recht dazu', () => {
    const reader = { canConfirm: false, canClose: false, canHandover: false, canCount: false, canRunConfirmations: false };
    wrap(<ClosingSteps status={status({ done: 1, me: reader, facts: { cash: { key: 'cash', accounts: [{ accountId: 'c1', name: 'Barkasse', count: null, later: null, confirmation: null }] } } })} names={NAMES} />);
    expect(within(screen.getByTestId('closing-body-cash')).queryByRole('link')).toBeNull();
    cleanup();
    wrap(<ClosingSteps status={status({ done: 6, me: reader })} names={NAMES} />);
    expect(within(screen.getByTestId('closing-body-confirmations')).queryByRole('link', { name: m('finance.closing.confirmations.run') })).toBeNull();
    cleanup();
    const uncounted = { key: 'cash' as const, accounts: [{ accountId: 'c1', name: 'Barkasse', count: null, later: null, confirmation: null }] };
    wrap(<ClosingSteps status={status({ done: 1, facts: { cash: uncounted } })} names={NAMES} />);
    expect(within(screen.getByTestId('closing-body-cash')).getByRole('link', { name: m('finance.closing.cash.toCash') }).getAttribute('href')).toBe('/finance/cash');
  });

  it('wiedergeöffnet (3c): Warnung mit Person, Grund und den zu wiederholenden Schritten', () => {
    wrap(<ClosingSteps status={status({ done: 7, yearStatus: 'open', reopened: { at: '2026-02-12T10:00:00Z', byUserId: 'u1', reason: 'Barbeleg nachgebucht.' }, toRepeat: ['close', 'auditPackage', 'auditReport'] })} names={NAMES} />);
    const notice = screen.getByTestId('closing-reopened');
    expect(notice.getAttribute('role')).toBe('status');
    expect(notice.textContent).toContain('Anna Berger');
    expect(notice.textContent).toContain('Barbeleg nachgebucht.');
    for (const n of ['8', '9', '10']) expect(notice.textContent).toContain(n);
  });

  it('Amtsübergaben des Jahres als Zeile mit Link, abgebrochene nicht', () => {
    wrap(<ClosingSteps status={status({ handovers: [{ id: 'h1', handoverOn: '2025-06-30', fromName: 'Anna Berger', toName: 'Lukas Hofmann', state: 'done' }, { id: 'h2', handoverOn: '2025-07-30', fromName: 'X', toName: 'Y', state: 'cancelled' }] })} names={NAMES} />);
    const lines = screen.getAllByTestId('closing-handover-line');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.getAttribute('href')).toBe('/finance/closing/handover/h1');
  });

  it('alle erledigt (3c): „Fertig.“ mit Ergebnis, Schritte zugeklappt hinter „Schritte ansehen“', () => {
    wrap(<ClosingSteps status={status({ done: 12, next: null, yearStatus: 'closed' })} names={NAMES} />);
    expect(screen.getAllByRole('status').some((s) => s.textContent?.includes('2025'))).toBe(true);
    const toggle = screen.getByRole('button', { name: m('finance.closing.showSteps') });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });
});
