// @vitest-environment jsdom
import type { AssemblyResultView, ClosingStatus, ClosingStepView } from '@kompass/module-finance';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }), usePathname: () => '/finance/closing', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/app/(shell)/dms/search-action', () => ({ searchDocumentsAction: vi.fn(async () => []) }));
vi.mock('@/app/(shell)/finance/closing/actions', () => ({ confirmStepAction: vi.fn(), closeYearAction: vi.fn(), reopenYearAction: vi.fn(), saveAssemblyAction: vi.fn(async () => ({ status: 'success' })), uploadMinutesAction: vi.fn(async () => ({ status: 'error', message: 'Die Datei ist kein PDF.', fieldErrors: { bytes: 'notPdf' } })) }));
const { AssemblyStep } = await import('@/app/(shell)/finance/closing/steps/assembly');
const { ClosingSteps } = await import('@/app/(shell)/finance/closing/closing-steps');
const { ClosingHeader } = await import('@/app/(shell)/finance/closing/closing-header');
const { saveAssemblyAction, uploadMinutesAction } = await import('@/app/(shell)/finance/closing/actions');

afterEach(cleanup);
beforeEach(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  vi.clearAllMocks();
});

/** Schritt 11 „Mitgliederversammlung“ (Plan C2 Task 6, Board 13d): Formular im Schritt, ohne Vorwahl, vertagt sperrt nichts. */
const m = (path: string) => path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], messages) as string;
const wrap = (node: ReactNode) => render(<NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">{node}</NextIntlClientProvider>);
const STATUS = { fiscalYearId: 'y25', designation: '2025', startsOn: '2025-01-01', endsOn: '2025-12-31', ended: true, yearStatus: 'closed', doneCount: 10, next: 'assembly', reopened: null, toRepeat: [], handovers: [], steps: [], me: { canConfirm: true, canClose: true, canHandover: false } } as unknown as ClosingStatus;
const PERSONS = [
  { contactId: 'c1', name: 'Petra Wagner', office: 'Vorsitzende', since: null, until: null },
  { contactId: 'c2', name: 'Jonas Krüger', office: null, since: null, until: '2025-06-30' },
];
const view = (result: AssemblyResultView | null, done = false, formerlyManaged: { label: string } | null = null): ClosingStepView<{ key: 'assembly'; result: AssemblyResultView | null; pending: { name: string; outcome: 'granted' | 'refused' | 'postponed' | null }[]; formerlyManaged: { label: string } | null }> => ({ key: 'assembly', number: 11, group: 'after', done, confirmable: false, confirmation: null, facts: { key: 'assembly', result, pending: result && !result.complete ? [{ name: 'Jonas Krüger', outcome: 'postponed' }] : [], formerlyManaged } });
const RESULT = (over: Partial<AssemblyResultView> = {}): AssemblyResultView => ({ fiscalYearId: 'y25', assemblyOn: '2026-03-14', warnings: [], auditReportFiledAt: null, minutesDocumentId: null, accountsApproved: 'yes', dischargeMode: 'individual', collectiveOutcome: null, discharges: [{ contactId: 'c1', outcome: 'granted', decidedOn: '2026-03-14' }, { contactId: 'c2', outcome: 'postponed', decidedOn: '2026-03-14' }], granted: 1, total: 2, complete: false, version: 'v1', updatedAt: 'v1', updatedByUserId: 'u1', managed: null, ...over });
const step = (result: AssemblyResultView | null = null) => <AssemblyStep step={view(result)} status={STATUS} canConfirm onConfirm={() => undefined} data={{ persons: PERSONS, minutes: null }} />;

describe('Schritt 11', () => {
  it('Einzeln ist Vorgabe; je Person eine Zeile mit Amt und Zeitraum, ohne Vorwahl', () => {
    wrap(step());
    const rows = screen.getAllByTestId('closing-assembly-person');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain(m('finance.closing.assembly.wholeYear'));
    expect(rows[1]!.textContent).toContain(m('finance.closing.assembly.boardMember'));
    expect(rows[1]!.textContent).toContain('30.06.2025');
    for (const row of rows) expect(within(row).getAllByRole('radio').some((r) => r.getAttribute('aria-checked') === 'true')).toBe(false);
    const mode = screen.getByTestId('closing-assembly-mode');
    expect(within(mode).getByRole('radio', { name: m('finance.closing.assembly.modes.individual') }).getAttribute('aria-checked')).toBe('true');
  });

  it('„vertagt“: Hinweis ohne Sperre, Speichern schickt das offene Ergebnis mit', async () => {
    wrap(step());
    fireEvent.change(screen.getByLabelText(new RegExp(m('finance.closing.assembly.date'))), { target: { value: '2026-03-14' } });
    fireEvent.click(screen.getByTestId('closing-assembly-discharge-c2-postponed'));
    expect(screen.getByTestId('closing-assembly-open').textContent).toContain('Jonas Krüger');
    fireEvent.click(screen.getByTestId('closing-assembly-save'));
    await waitFor(() => expect(saveAssemblyAction).toHaveBeenCalled());
    expect(vi.mocked(saveAssemblyAction).mock.calls[0]![0]).toMatchObject({ assemblyOn: '2026-03-14', dischargeMode: 'individual', discharges: [{ contactId: 'c1', outcome: null }, { contactId: 'c2', outcome: 'postponed' }] });
  });

  it('V-8: Gremien führte das Ergebnis und ist aus — ein Hinweis mit der Sitzung, das Formular gilt wieder', () => {
    wrap(<AssemblyStep step={view(null, false, { label: 'Mitgliederversammlung am 14.03.2026' })} status={STATUS} canConfirm onConfirm={() => undefined} data={{ persons: PERSONS, minutes: null }} />);
    expect(screen.getByTestId('closing-assembly-formerly-managed').textContent).toContain('Mitgliederversammlung am 14.03.2026');
    expect(screen.getByTestId('closing-assembly-save')).toBeTruthy();
    cleanup();
    wrap(step());
    expect(screen.queryByTestId('closing-assembly-formerly-managed')).toBeNull();
  });

  it('MV vor dem Prüfbericht (Entscheidung c): Hinweis unter dem Datum, Speichern bleibt', () => {
    wrap(step(RESULT({ assemblyOn: '2026-02-10', warnings: ['assemblyBeforeAuditReport'], auditReportFiledAt: '2026-02-20T10:00:00Z' })));
    expect(screen.getByTestId('closing-assembly-before-report').textContent).toContain('20.02.2026');
    expect(screen.getByTestId('closing-assembly-save').hasAttribute('disabled')).toBe(false);
    cleanup();
    wrap(step(RESULT()));
    expect(screen.queryByTestId('closing-assembly-before-report')).toBeNull();
  });

  it('Gesamt: ein Segmented statt der Personen', () => {
    wrap(step());
    fireEvent.click(within(screen.getByTestId('closing-assembly-mode')).getByRole('radio', { name: m('finance.closing.assembly.modes.collective') }));
    expect(screen.queryByTestId('closing-assembly-persons')).toBeNull();
    expect(screen.getByTestId('closing-assembly-collective')).toBeTruthy();
  });

  it('gespeichertes Ergebnis mit Version: der nächste Speichern-Aufruf trägt sie als erwarteten Stand', async () => {
    wrap(step(RESULT()));
    fireEvent.click(screen.getByTestId('closing-assembly-discharge-c2-granted'));
    fireEvent.click(screen.getByTestId('closing-assembly-save'));
    await waitFor(() => expect(saveAssemblyAction).toHaveBeenCalled());
    expect(vi.mocked(saveAssemblyAction).mock.calls[0]![0]).toMatchObject({ expectedVersion: 'v1' });
  });

  it('Schlussdurchsicht I1: ein nach dem Speichern abgelegtes Protokoll wird beim nächsten Speichern nicht wieder abgehängt', async () => {
    const result = RESULT();
    const { rerender } = wrap(<AssemblyStep step={view(result)} status={STATUS} canConfirm onConfirm={() => undefined} data={{ persons: PERSONS, minutes: null }} />);
    // Nach dem Hochladen baut der Server die Seite neu: das Protokoll liegt, das Formular bleibt montiert.
    const filed = { ...result, minutesDocumentId: 'd1', version: 'v2' };
    rerender(<NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin"><AssemblyStep step={view(filed)} status={STATUS} canConfirm onConfirm={() => undefined} data={{ persons: PERSONS, minutes: { id: 'd1', number: 'PR-1', subject: 'Protokoll', phase: 'issued' } }} /></NextIntlClientProvider>);
    fireEvent.click(screen.getByTestId('closing-assembly-discharge-c2-granted'));
    fireEvent.click(screen.getByTestId('closing-assembly-save'));
    await waitFor(() => expect(saveAssemblyAction).toHaveBeenCalled());
    expect(vi.mocked(saveAssemblyAction).mock.calls[0]![0].minutesDocumentId).not.toBeNull();
  });

  it('Schlussdurchsicht I2: eine abgelehnte Datei beim Protokoll nennt den Grund', async () => {
    const { container } = wrap(step(RESULT()));
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['%PDF-1.4 x'], 'p.pdf', { type: 'application/pdf' })] } });
    await waitFor(() => expect(uploadMinutesAction).toHaveBeenCalled());
    expect(await screen.findByText('Die Datei ist kein PDF.')).toBeTruthy();
  });

  it('vertagt gespeichert, Schritt 12 erledigt (14b): Schritt 11 offen mit Satz und „Ergebnis nachtragen“, das Formular erst nach dem Klick', () => {
    const tax: ClosingStepView = { key: 'taxReturn', number: 12, group: 'after', done: true, confirmable: true, confirmation: null, facts: { key: 'taxReturn', vat: null, period: null } };
    const parked = { ...STATUS, doneCount: 11, next: 'assembly', steps: [view(RESULT()), tax] } as unknown as ClosingStatus;
    wrap(
      <>
        <ClosingHeader status={parked} reopen={null} />
        <ClosingSteps status={parked} names={{ c1: 'Petra Wagner', c2: 'Jonas Krüger' }} assembly={{ persons: PERSONS, minutes: null }} />
      </>,
    );
    const item = document.getElementById('step-assembly')!;
    expect(item.getAttribute('data-state')).toBe('todo');
    expect(item.textContent).toContain('Jonas Krüger');
    expect(within(item).queryByTestId('closing-body-assembly')).toBeNull();
    const toggle = within(item).getByRole('button', { name: m('finance.closing.assembly.fillIn') });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(within(item).getByTestId('closing-body-assembly')).toBeTruthy();
    expect(document.querySelectorAll('[aria-current="step"]')).toHaveLength(0);
    // Der Kopf nennt die offene Entlastung mit Namen und Zustand aus dem Stand.
    const head = screen.getByTestId('closing-head').textContent!;
    expect(head).toContain('Jonas Krüger');
    expect(head).toContain(m('finance.closing.assembly.outcomes.postponed'));
  });

  it('G7: führt Gremien das Ergebnis, steht statt „Ergebnis nachtragen“ ein fester Wert mit Link zur Sitzung — offen wie erledigt', () => {
    const managed = { module: 'governance', meetingId: 'M1', label: 'Mitgliederversammlung 14.03.2026', href: '/governance/meetings/M1' };
    const parked = { ...STATUS, doneCount: 10, next: 'assembly', steps: [view(RESULT({ managed, updatedByUserId: null }))] } as unknown as ClosingStatus;
    wrap(<ClosingSteps status={parked} names={{}} assembly={{ persons: PERSONS, minutes: null }} />);
    const item = document.getElementById('step-assembly')!;
    expect(within(item).queryByRole('button', { name: m('finance.closing.assembly.fillIn') })).toBeNull();
    expect(within(item).queryByTestId('closing-body-assembly')).toBeNull();
    const fixed = within(item).getByTestId('closing-assembly-managed');
    expect(within(fixed).getByRole('link', { name: managed.label }).getAttribute('href')).toBe('/governance/meetings/M1');
    cleanup();
    const done = { ...STATUS, next: 'taxReturn', steps: [view(RESULT({ managed, updatedByUserId: null, discharges: [{ contactId: 'c1', outcome: 'granted', decidedOn: '2026-03-14' }], granted: 1, total: 1, complete: true }), true)] } as unknown as ClosingStatus;
    wrap(<ClosingSteps status={done} names={{}} assembly={{ persons: PERSONS, minutes: null }} />);
    expect(within(document.getElementById('step-assembly')!).getByTestId('closing-assembly-managed')).toBeTruthy();
  });

  it('ohne Recht: kein Formular, keine Ablage des Protokolls, nur der Satz, wer eintragen kann', () => {
    wrap(<AssemblyStep step={view(RESULT())} status={STATUS} canConfirm={false} onConfirm={() => undefined} data={{ persons: PERSONS, minutes: null }} />);
    const body = screen.getByTestId('closing-body-assembly');
    expect(within(body).queryByRole('textbox')).toBeNull();
    expect(within(body).queryByRole('combobox')).toBeNull();
    expect(within(body).queryAllByRole('radio')).toHaveLength(0);
    expect(body.querySelector('input')).toBeNull();
  });

  it('ohne Ergebnis aktiv mit Formular; erledigt einzeln mit Zahl', () => {
    const open = { ...STATUS, steps: [view(null)] } as unknown as ClosingStatus;
    wrap(<ClosingSteps status={open} names={{}} assembly={{ persons: PERSONS, minutes: null }} />);
    const item = document.getElementById('step-assembly')!;
    expect(item.getAttribute('data-state')).toBe('active');
    expect(within(item).getByTestId('closing-body-assembly')).toBeTruthy();
    cleanup();
    const done = { ...STATUS, next: 'taxReturn', steps: [view(RESULT({ discharges: [{ contactId: 'c1', outcome: 'granted', decidedOn: null }, { contactId: 'c2', outcome: 'granted', decidedOn: null }], granted: 2, complete: true }), true)] } as unknown as ClosingStatus;
    wrap(<ClosingSteps status={done} names={{}} />);
    expect(document.getElementById('step-assembly')!.textContent).toContain('14.03.2026');
    expect(document.getElementById('step-assembly')!.textContent).toContain('2');
  });

  it('Schritt 11 verweist auf Kassenbericht und Jahresrechnung des Jahres (Spec Teil J)', () => {
    wrap(step());
    const hint = document.getElementById(screen.getByTestId('closing-assembly-accounts').getAttribute('aria-describedby') ?? '')!;
    const links = within(hint).getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/finance/reports/cashReport?year=y25', '/finance/reports/annualAccounts?year=y25']);
  });
});
