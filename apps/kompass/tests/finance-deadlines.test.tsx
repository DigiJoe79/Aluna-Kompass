// @vitest-environment jsdom
import type { DeadlineView, ThresholdView } from '@kompass/module-finance';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { formatEuro } from '@/lib/finance/amount';

const toastRefusal = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }), usePathname: () => '/finance/deadlines', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/feedback', async (orig) => ({ ...(await orig<typeof import('@/lib/feedback')>()), toastRefusal }));
vi.mock('@/app/(shell)/finance/deadlines/actions', () => ({
  createFollowUpAction: vi.fn(async () => ({ status: 'success' })),
  completeFollowUpAction: vi.fn(async () => ({ status: 'success' })),
  reopenFollowUpAction: vi.fn(async () => ({ status: 'error', message: 'Nicht erlaubt.', fieldErrors: {} })),
  recordVatFilingAction: vi.fn(async () => ({ status: 'success' })),
}));
vi.mock('@/app/(shell)/finance/vat/actions', () => ({ updateVatFilingAction: vi.fn(), fileVatFilingDocumentAction: vi.fn() }));
vi.mock('@/app/(shell)/dms/search-action', () => ({ searchDocumentsAction: vi.fn(async () => []) }));
vi.mock('@/app/(shell)/finance/donations/notices/actions', () => ({
  saveNoticeAction: vi.fn(async () => ({ status: 'success', data: { id: 'n1', kind: 'exemptionNotice', taxOffice: 'FA', taxNumber: '1', noticeDate: '2026-05-01', exemptFrom: null, assessmentPeriod: null, purposesText: 'x', purposesTextAccusative: null, documentId: null, documentNumber: null, suggestions: [{ key: 'noticeToBank' }] } })),
  attachNoticeDocumentAction: vi.fn(),
}));
const { DeadlineList, DeadlinesHeader } = await import('@/app/(shell)/finance/deadlines/deadline-list');
const { FollowUpList } = await import('@/app/(shell)/finance/deadlines/follow-up-list');
const { ThresholdList } = await import('@/app/(shell)/finance/deadlines/threshold-list');
const { AddNoticeButton } = await import('@/app/(shell)/finance/donations/notices/add-notice-button');
const actions = await import('@/app/(shell)/finance/deadlines/actions');

afterEach(cleanup);
beforeEach(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  vi.clearAllMocks();
});

/** Fristen und Schwellen (Plan C2 Task 9, Board 6a). */
const m = (path: string) => path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], messages) as string;
const wrap = (node: ReactNode) => render(<NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">{node}</NextIntlClientProvider>);
const D = (over: Partial<DeadlineView>): DeadlineView => ({ key: 'k', kind: 'noticeExpiry', dueOn: '2026-11-30', overdue: false, params: {}, href: '/finance/donations/notices', ...over });
const DEADLINES = [D({ key: 'confirmationsToCorrect', kind: 'confirmationsToCorrect', dueOn: null, params: { count: 2 }, href: '/finance/donations' }), D({ key: 'vatReturn:2025', kind: 'vatReturn', dueOn: '2026-07-31', overdue: true, params: { year: '2025' }, href: '/finance/closing?year=y25' }), D({ key: 'noticeExpiry:n1' })];

describe('Kopf', () => {
  it('nennt die nächste datierte Frist und die Schwellen, sonst „keine Frist“', () => {
    wrap(<DeadlinesHeader deadlines={DEADLINES.map((d) => ({ ...d, overdue: false }))} approaching={1} exceeded={0} />);
    const head = screen.getByTestId('deadlines-head').textContent!;
    expect(head).toContain('31.07.2026');
    expect(head).toContain('2025');
    cleanup();
    wrap(<DeadlinesHeader deadlines={[]} approaching={0} exceeded={0} />);
    expect(screen.getByTestId('deadlines-head').textContent).toBe(m('finance.deadlines.headNone'));
  });

  it('überfällige zuerst und so benannt, ohne „bis“ (295)', () => {
    wrap(<DeadlinesHeader deadlines={DEADLINES} approaching={0} exceeded={0} />);
    const head = screen.getByTestId('deadlines-head').textContent!;
    expect(head).toContain('2025');
    expect(head).not.toContain('31.07.2026');
    expect(head).not.toContain('30.11.2026');
  });

  it('nennt zuerst, was unverzüglich ist, dann jede überfällige Frist (Befund 30 d)', () => {
    const amendment = D({ key: 'vatAmendment:2026-Q2', kind: 'vatAmendment', dueOn: null, params: { vatPeriod: '2026-Q2', scope: 'advance' }, href: '/finance/vat' });
    const overdue = [D({ key: 'vatReturn:2024', kind: 'vatReturn', dueOn: '2025-07-31', overdue: true, params: { year: '2024' } }), D({ key: 'vatReturn:2025', kind: 'vatReturn', dueOn: '2026-07-31', overdue: true, params: { year: '2025' } })];
    wrap(<DeadlinesHeader deadlines={[amendment, ...overdue]} approaching={0} exceeded={0} />);
    const head = screen.getByTestId('deadlines-head').textContent!;
    expect(head.indexOf('Q2 2026')).toBeGreaterThanOrEqual(0);
    expect(head.indexOf('Q2 2026')).toBeLessThan(head.indexOf('2024'));
    expect(head).toContain('2025');
  });
});

describe('Fristen', () => {
  it('ohne Kästchen; Frist als Link; überfällig als Marke; „Abgabe eintragen …“ nur an der USt-Erklärung und nur mit Recht', async () => {
    wrap(<DeadlineList deadlines={DEADLINES} canFileVat canRead today="2026-10-24" />);
    const rows = screen.getAllByTestId('deadline-row');
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    const vat = rows.find((r) => r.getAttribute('data-kind') === 'vatReturn')!;
    expect(within(vat).getAllByRole('link')[0]!.getAttribute('href')).toBe('/finance/closing?year=y25');
    expect(within(vat).getByText(m('finance.deadlines.computed.overdue'))).toBeTruthy();
    expect(screen.getAllByTestId('deadline-vat')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('deadline-vat'));
    const dialog = await screen.findByTestId('vat-dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: m('finance.deadlines.vatDialog.save') }));
    await waitFor(() => expect(actions.recordVatFilingAction).toHaveBeenCalledWith('2025', '2026-10-24'));
    cleanup();
    wrap(<DeadlineList deadlines={DEADLINES} canFileVat={false} canRead today="2026-10-24" />);
    expect(screen.queryByTestId('deadline-vat')).toBeNull();
  });
});

describe('Umsatzsteuer-Fristen (Plan E6a Task 6)', () => {
  const VAT = [
    D({ key: 'vatAdvanceReturn:2026-Q3', kind: 'vatAdvanceReturn', dueOn: '2026-10-12', overdue: true, params: { vatPeriod: '2026-Q3' }, href: '/finance/entries' }),
    D({ key: 'vatReturn:2026', kind: 'vatReturn', dueOn: '2027-08-02', params: { year: '2026' }, href: '/finance/closing?year=y26' }),
    D({ key: 'vatAmendment:2026-Q2', kind: 'vatAmendment', dueOn: null, params: { vatPeriod: '2026-Q2', scope: 'advance' }, href: '/finance/entries' }),
  ];

  it('„Abgabe eintragen …“ an Voranmeldung, Jahreserklärung und Berichtigung, nur mit Recht; der Dialog trägt den Zeitraum', async () => {
    wrap(<DeadlineList deadlines={VAT} canFileVat canRead today="2027-01-04" />);
    const buttons = screen.getAllByTestId('deadline-vat');
    expect(buttons).toHaveLength(3);
    fireEvent.click(buttons[2]!);
    const dialog = await screen.findByTestId('vat-dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: m('finance.deadlines.vatDialog.save') }));
    await waitFor(() => expect(actions.recordVatFilingAction).toHaveBeenCalledWith('2026-Q2', '2027-01-04'));
    cleanup();
    wrap(<DeadlineList deadlines={VAT} canFileVat={false} canRead today="2027-01-04" />);
    expect(screen.queryByTestId('deadline-vat')).toBeNull();
  });

  it('vor dem Ende des Zeitraums statt des Knopfs „Abgabe ab …“ (die Abgabe würde abgelehnt)', () => {
    wrap(<DeadlineList deadlines={VAT} canFileVat canRead today="2026-10-24" />);
    expect(screen.getAllByTestId('deadline-vat')).toHaveLength(2);
    const year = screen.getAllByTestId('deadline-row').find((r) => r.getAttribute('data-kind') === 'vatReturn')!;
    expect(within(year).queryByTestId('deadline-vat')).toBeNull();
    expect(within(year).getByTestId('deadline-vat-from').textContent).toBe('Abgabe ab 01.01.2027');
  });

  it('Berichtigung oben, unverzüglich, mit Auslöser; „Abgabe eintragen …“ steht in der Bezugsspalte (Board 5a)', () => {
    const amendment = D({ key: 'vatAmendment:2026-Q2', kind: 'vatAmendment', dueOn: null, params: { vatPeriod: '2026-Q2', scope: 'advance', entryNumber: 'B-2026-0151', change: 'corrected', changedOn: '2026-10-25', more: 0 }, href: '/finance/entries' });
    wrap(<DeadlineList deadlines={[amendment, VAT[0]!, VAT[1]!]} canFileVat canRead today="2026-10-25" />);
    const rows = screen.getAllByTestId('deadline-row');
    expect(rows.map((r) => r.getAttribute('data-kind'))).toEqual(['vatAmendment', 'vatAdvanceReturn', 'vatReturn']);
    expect(within(rows[0]!).getByText(m('finance.deadlines.computed.immediately'))).toBeTruthy();
    expect(within(rows[0]!).getByTestId('deadline-cause').textContent).toContain('B-2026-0151');
    expect(within(rows[1]!).queryByTestId('deadline-cause')).toBeNull();
    for (const row of rows.slice(0, 2)) expect(within(within(row).getByTestId('deadline-subject')).getAllByRole('button', { name: m('finance.deadlines.computed.vatFile') }).length).toBeGreaterThan(0);
    // Die Jahreserklärung 2026 läuft noch (Befund 33): statt des Knopfs der erste mögliche Tag.
    expect(within(rows[2]!).getByTestId('deadline-vat-from').textContent).toBe('Abgabe ab 01.01.2027');
    // Designer Runde 8, Vorweg 3: Nur der Titel führt zur Voranmeldung bzw. zu den Summen; der Bezug ist Text.
    for (const row of rows) {
      expect(within(within(row).getByTestId('deadline-subject')).queryByRole('link')).toBeNull();
      expect(within(row).getAllByRole('link')).toHaveLength(1);
    }
    // Ohne Ursache (Abgabe ohne Abbild) keine Unterzeile.
    cleanup();
    wrap(<DeadlineList deadlines={[VAT[2]!]} canFileVat canRead today="2026-10-25" />);
    expect(screen.queryByTestId('deadline-cause')).toBeNull();
  });

  it('macht den Zeitraum lesbar: Quartal, Monat, Jahr', async () => {
    const { vatPeriodLabel } = await import('@/lib/finance/vat-period');
    const t = (key: string, v: Record<string, string>) => `${key.split('.').at(-1)}:${Object.values(v).join('/')}`;
    expect(vatPeriodLabel('2026-Q2', t)).toBe('quarter:2/2026');
    expect(vatPeriodLabel('2026-05', t)).toBe('month:05/2026');
    expect(vatPeriodLabel('2026', t)).toBe('2026');
  });
});

describe('Verwendungsfrist (Plan U2 Task 5)', () => {
  const USE = D({ key: 'timelyUse:fy:y24', kind: 'timelyUse', dueOn: '2026-12-31', params: { origin: '2024', restCents: 340_000 }, href: '/finance/fund-use?year=y26' });
  const LAPSED = D({ key: 'timelyUseLapsed:fy:y23', kind: 'timelyUseLapsed', dueOn: null, params: { origin: '2023', lapsedIn: '2025' }, href: '/finance/fund-use?year=y25' });

  it('a backlog shows the rest under its title, which links to the year; overdue carries the mark', () => {
    wrap(<DeadlineList deadlines={[{ ...USE, overdue: true }]} canFileVat={false} canRead today="2027-01-10" />);
    const row = screen.getByTestId('deadline-row');
    expect(within(row).getByRole('link').getAttribute('href')).toBe('/finance/fund-use?year=y26');
    expect(within(row).getByTestId('deadline-rest').textContent).toContain(formatEuro(340_000));
    expect(within(row).getByText(m('finance.deadlines.computed.overdue'))).toBeTruthy();
  });

  it('a lapsed note stands without date and mark, and the head does not name it (Review Focus 4)', () => {
    wrap(<DeadlineList deadlines={[LAPSED]} canFileVat={false} canRead today="2026-03-01" />);
    const row = screen.getByTestId('deadline-row');
    expect(row.textContent).toContain(m('finance.deadlines.computed.noDate'));
    expect(within(row).queryByText(m('finance.deadlines.computed.overdue'))).toBeNull();
    expect(within(row).queryByTestId('deadline-rest')).toBeNull();
    cleanup();
    wrap(<DeadlinesHeader deadlines={[LAPSED]} approaching={0} exceeded={0} />);
    expect(screen.getByTestId('deadlines-head').textContent).toBe(m('finance.deadlines.headNone'));
  });
});

describe('Fristen mit nur finance.overview', () => {
  it('Frist als Text statt Link, keine ForbiddenCard dahinter', () => {
    wrap(<DeadlineList deadlines={DEADLINES} canFileVat={false} canRead={false} today="2026-10-24" />);
    const rows = screen.getAllByTestId('deadline-row');
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(within(row).queryByRole('link')).toBeNull();
  });
});

describe('Wiedervorlagen', () => {
  const ROWS = [
    { id: 'f1', dueAt: '2026-09-30', title: 'Kopie an die Gemeinde', titleHidden: false, doneAt: null, target: { label: 'Geschäftsjahr 2026', href: '/finance/closing?year=y26' } },
    { id: 'f2', dueAt: '2026-01-31', title: 'Sammelbestätigung', titleHidden: false, doneAt: '2026-10-10T10:00:00Z', target: null },
  ];
  const list = (over: Partial<React.ComponentProps<typeof FollowUpList>> = {}) => wrap(<FollowUpList rows={ROWS} canManage years={[{ id: 'y26', designation: '2026' }, { id: 'y25', designation: '2025' }]} defaultYearId="y26" suggestion={null} today="2026-10-24" {...over} />);

  it('Kästchen hakt ab; erledigte gedämpft; eine Ablehnung geht an toastRefusal', async () => {
    list();
    const rows = screen.getAllByTestId('follow-up-row');
    expect(rows[1]!.hasAttribute('data-muted')).toBe(true);
    expect(within(rows[0]!).getByText(m('finance.deadlines.followUps.overdue'))).toBeTruthy();
    expect(within(rows[0]!).getByRole('link').getAttribute('href')).toBe('/finance/closing?year=y26');
    fireEvent.click(within(rows[0]!).getByRole('checkbox'));
    await waitFor(() => expect(actions.completeFollowUpAction).toHaveBeenCalledWith('f1'));
    fireEvent.click(within(rows[1]!).getByRole('checkbox'));
    await waitFor(() => expect(toastRefusal).toHaveBeenCalled());
  });

  it('Vorschlag „Jahresabschluss vor der MV“: Hinweis mit vorbelegtem Dialog (Titel, Bezug)', async () => {
    list({ suggestion: { fiscalYearId: 'y25', designation: '2025' } });
    fireEvent.click(screen.getByTestId('follow-up-suggestion-create'));
    const dialog = await screen.findByTestId('follow-up-dialog');
    expect((within(dialog).getByLabelText(new RegExp(m('finance.deadlines.followUpDialog.name'))) as HTMLInputElement).value).toContain('2025');
    expect((within(dialog).getByLabelText(m('finance.deadlines.followUpDialog.subject')) as HTMLSelectElement).value).toBe('y25');
    fireEvent.change(within(dialog).getByLabelText(new RegExp(m('finance.deadlines.followUpDialog.dueOn'))), { target: { value: '2027-02-15' } });
    fireEvent.click(within(dialog).getByRole('button', { name: m('finance.deadlines.followUpDialog.save') }));
    await waitFor(() => expect(actions.createFollowUpAction).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'financeFiscalYear', entityId: 'y25', dueAt: '2027-02-15' })));
  });

  it('ohne followUps.manage: kein Anlegen, kein Vorschlag, Kästchen gesperrt', () => {
    list({ canManage: false, suggestion: { fiscalYearId: 'y25', designation: '2025' } });
    expect(screen.queryByTestId('follow-up-create')).toBeNull();
    expect(screen.queryByTestId('follow-up-suggestion')).toBeNull();
    expect(screen.getAllByRole('checkbox').every((c) => c.hasAttribute('data-disabled') || (c as HTMLButtonElement).disabled)).toBe(true);
  });
});

describe('Schwellen', () => {
  const T = (over: Partial<ThresholdView>): ThresholdView => ({ key: 'business', state: 'quiet', valueCents: 294000, limitCents: 5000000, notes: [], person: null, ...over });
  it('Balken nur für Schwellen mit Grenze und Zustand; die übrigen als Satz; Person nur, wenn der Dienst sie nennt', () => {
    wrap(
      <ThresholdList
        thresholds={[T({}), T({ key: 'allowanceVolunteer', state: 'approaching', valueCents: 78000, limitCents: 84000, person: { contactId: 'c', name: 'Helga Sommer' } }), T({ key: 'timelyUse', state: 'noObligation', valueCents: 1000, limitCents: 10000000 }), T({ key: 'smallBusinessPrevYear', state: 'notModelled', valueCents: null, limitCents: null })]}
        years={[{ id: 'y25', designation: '2025' }]}
        yearId="y25"
        designation="2025"
      />,
    );
    const items = screen.getAllByTestId('threshold');
    expect(items.map((i) => within(i).queryByTestId('limit-progress') !== null)).toEqual([true, true, false, false]);
    expect(items[1]!.textContent).toContain('Helga Sommer');
    expect(items[1]!.querySelector('[data-state="near"]')).not.toBeNull();
  });
});

describe('Bescheid gespeichert (Antwort Joe 2026-10-24)', () => {
  it('nach dem ersten Speichern: Hinweis „Kopie der Bank“, „Wiedervorlage anlegen …“ öffnet den vorbelegten Dialog am Bescheid', async () => {
    wrap(<AddNoticeButton canPickDocument={false} canFollowUp />);
    fireEvent.click(screen.getByRole('button', { name: m('finance.donations.notices.add') }));
    const form = await screen.findByTestId('notice-form');
    fireEvent.click(within(form.closest('[role="dialog"]') as HTMLElement).getByRole('button', { name: m('common.save') }));
    fireEvent.click(await screen.findByTestId('notice-bank-follow-up'));
    const dialog = await screen.findByTestId('follow-up-dialog');
    expect((within(dialog).getByLabelText(new RegExp(m('finance.deadlines.followUpDialog.name'))) as HTMLInputElement).value).toBe(m('finance.donations.notices.dialog.bankFollowUpTitle'));
    expect(dialog.textContent).toContain('01.05.2026');
  });
});
