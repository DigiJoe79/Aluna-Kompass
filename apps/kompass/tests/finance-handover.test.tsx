// @vitest-environment jsdom
import type { HandoverView as Handover } from '@kompass/module-finance';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { buttonVariants } from '@/components/ui/button';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push }), usePathname: () => '/finance/closing/handover/h1', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/app/(shell)/contacts/search-action', () => ({ searchContactsAction: vi.fn(async () => ({ items: [], more: false })) }));
vi.mock('@/app/(shell)/finance/closing/handover/actions', () => ({
  handoverDefaultsAction: vi.fn(async () => ({ from: { id: 'c1', name: 'Anna Berger' } })),
  startHandoverAction: vi.fn(async () => ({ status: 'success', data: { id: 'h9' } })),
  updateHandoverAction: vi.fn(),
  cancelHandoverAction: vi.fn(),
  interimReportAction: vi.fn(async () => ({ status: 'success' })),
  countCashForHandoverAction: vi.fn(async () => ({ status: 'success' })),
  saveHandoverItemsAction: vi.fn(async () => ({ status: 'success' })),
  fileProtocolAction: vi.fn(async () => ({ status: 'error', message: 'Die Datei ist kein PDF.', fieldErrors: { bytes: 'notPdf' } })),
}));
vi.mock('@/app/(shell)/finance/cash/actions', () => ({ countCashAction: vi.fn(), emptyDonationBoxAction: vi.fn() }));
const { HandoverView } = await import('@/app/(shell)/finance/closing/handover/handover-view');
const { HandoverStartDialog } = await import('@/app/(shell)/finance/closing/handover-start-dialog');
const actions = await import('@/app/(shell)/finance/closing/handover/actions');

afterEach(cleanup);
beforeEach(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  vi.clearAllMocks();
});

/** Amtsübergabe (Plan C2 Task 8, Board 13e): Kopf, drei Schritte, Daran denken, Beginnen-Dialog. */
const m = (path: string) => path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], messages) as string;
const wrap = (node: ReactNode) => render(<NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">{node}</NextIntlClientProvider>);
const H = (over: Partial<Handover> = {}): Handover => ({
  id: 'h1', handoverOn: '2026-06-30', fromName: 'Anna Berger', toName: 'Lukas Hofmann', state: 'open', fiscalYearId: 'y26', fromContactId: 'c1', toContactId: 'c2',
  interimReport: null, cashAccounts: [{ accountId: 'k1', name: 'Barkasse', bookCents: 31240, count: null }], cashRequired: true,
  items: [{ id: 'i1', key: 'cash', label: null, note: null, checked: false }, { id: 'i2', key: 'records', label: null, note: null, checked: false }, { id: 'i3', key: 'kompass', label: null, note: null, checked: false }],
  protocolDocumentId: null, doneCount: 0, statutoryBoard: null, version: 'v1', ...over,
});
const view = (h: Handover, canManage = true, canCount = canManage) => wrap(<HandoverView handover={h} year={{ id: 'y26', designation: '2026', startsOn: '2026-01-01' }} back={{ href: '/finance/closing?year=y26', label: 'Jahresabschluss 2026' }} canManage={canManage} canCount={canCount} canCreateContact={false} />);
const state = (key: string) => screen.getByTestId(`handover-steps-${key}`).getAttribute('data-state');
const INTERIM = { params: { fiscalYearId: 'y26', date: '2026-06-30' }, hash: 'a41d93e0ff', shortHash: 'a41d93e0', at: '2026-06-30T18:00:00Z' };

describe('Amtsübergabe', () => {
  it('Kopf: Rückweg, Satz mit Namen, Tag und Stand; Schritt 1 aktiv mit „Erzeugen“', async () => {
    view(H());
    expect(screen.getByRole('link', { name: /Jahresabschluss 2026/ }).getAttribute('href')).toBe('/finance/closing?year=y26');
    const head = screen.getByTestId('handover-head').textContent!;
    for (const part of ['Anna Berger', 'Lukas Hofmann', '30.06.2026', '0']) expect(head).toContain(part);
    expect([state('interim'), state('cash'), state('protocol')]).toEqual(['active', 'todo', 'todo']);
    fireEvent.click(screen.getByTestId('handover-interim'));
    await waitFor(() => expect(actions.interimReportAction).toHaveBeenCalledWith('h1'));
  });

  it('Zwischenbericht erledigt: Link mit Stichtag und Kurz-Hash; Schritt 2 mit „Kasse zählen …“, Zählung über die Übergabe, die neue Person zählt mit', async () => {
    view(H({ interimReport: INTERIM }));
    expect(screen.getByTestId('handover-interim-link').getAttribute('href')).toBe('/finance/reports/cashReport?year=y26&date=2026-06-30');
    expect(screen.getByTestId('handover-steps-interim').textContent).toContain('a41d93e0');
    fireEvent.click(screen.getByTestId('handover-count'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByDisplayValue('Lukas Hofmann')).toBeTruthy();
    expect(within(dialog).queryByTestId('count-handover-witness')).toBeNull();
    expect(within(dialog).queryByRole('radio')).toBeNull();
    expect(within(dialog).queryByLabelText(m('finance.cash.count.date'))?.tagName).not.toBe('INPUT');
  });

  it('ohne Barkasse ist Schritt 2 erledigt; Schritt 3: Punkte abhaken und speichern, eigener Punkt, Drucken und Scan', async () => {
    view(H({ interimReport: INTERIM, cashRequired: false, cashAccounts: [] }));
    expect(state('cash')).toBe('done');
    expect(state('protocol')).toBe('active');
    const items = screen.getAllByTestId('handover-item');
    fireEvent.click(within(items[1]!).getByRole('checkbox'));
    fireEvent.click(screen.getByTestId('handover-item-add'));
    expect(screen.getAllByTestId('handover-item')).toHaveLength(4);
    fireEvent.change(within(screen.getAllByTestId('handover-item')[3]!).getByRole('textbox', { name: m('finance.closing.handover.protocol.customLabel') }), { target: { value: 'Bargeldkarte' } });
    fireEvent.click(screen.getByTestId('handover-items-save'));
    await waitFor(() => expect(actions.saveHandoverItemsAction).toHaveBeenCalled());
    const [id, sent, version] = vi.mocked(actions.saveHandoverItemsAction).mock.calls[0]!;
    expect(id).toBe('h1');
    expect(version).toBe('v1');
    expect(sent.find((i) => i.id === 'i2')!.checked).toBe(true);
    expect(sent.at(-1)).toMatchObject({ key: 'custom', label: 'Bargeldkarte', checked: false });
    expect(screen.getByTestId('handover-print')).toBeTruthy();
    fireEvent.click(screen.getByTestId('handover-scan'));
    expect(await screen.findByTestId('handover-scan-dialog')).toBeTruthy();
  });

  it('Schritt 2 (14c): jede Kasse mit Bestand zählen; mit Differenz bleibt er offen; je Kasse ein Dialog mit ihrem Namen', async () => {
    const two = (count: Handover['cashAccounts'][number]['count']) => H({ interimReport: INTERIM, cashAccounts: [{ accountId: 'k1', name: 'Barkasse', bookCents: 8500, count: { countId: 'c', countedCents: 8500, differenceCents: 0 } }, { accountId: 'k2', name: 'Zählkasse', bookCents: 14000, count }] });
    view(two(null));
    expect(state('cash')).toBe('active');
    const rows = screen.getAllByTestId('handover-cash-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).queryByTestId('handover-count')).toBeNull();
    fireEvent.click(within(rows[1]!).getByTestId('handover-count'));
    expect((await screen.findByRole('dialog')).textContent).toContain('Zählkasse');
    cleanup();
    view(two({ countId: 'd', countedCents: 13000, differenceCents: -1000 }));
    expect(state('cash')).toBe('active');
    expect(screen.getAllByTestId('handover-cash-row')[1]!.textContent).toContain('10,00');
    cleanup();
    view(two({ countId: 'd', countedCents: 14000, differenceCents: 0 }));
    expect(state('cash')).toBe('done');
    expect(screen.getByTestId('handover-steps-cash').textContent).toContain('Zählkasse');
  });

  it('Schritt 3 (14c): Notizfeld erst nach „Notiz hinzufügen“, eine gespeicherte Notiz steht als Text', () => {
    const items = [{ id: 'i1', key: 'cash' as const, label: null, note: 'Schlüssel übergeben', checked: true }, { id: 'i2', key: 'records' as const, label: null, note: null, checked: true }];
    view(H({ interimReport: INTERIM, cashRequired: false, cashAccounts: [], items }));
    expect(screen.queryByRole('textbox', { name: m('finance.closing.handover.protocol.note') })).toBeNull();
    expect(screen.getAllByTestId('handover-item')[0]!.textContent).toContain('Schlüssel übergeben');
    fireEvent.click(within(screen.getAllByTestId('handover-item')[1]!).getByTestId('handover-item-note'));
    expect(screen.getByRole('textbox', { name: m('finance.closing.handover.protocol.note') })).toBeTruthy();
  });

  it('Schritt 3 (Runde 6, Antwort 1): keine eigene Karte; Speichern, Drucken und Scan in der Leiste; Scan erst primär, wenn alles gehakt und gespeichert ist', () => {
    const PRIMARY = buttonVariants({ variant: 'default' }).split(/\s+/);
    const primary = (el: HTMLElement) => PRIMARY.every((c) => el.classList.contains(c));
    const all = H({ interimReport: INTERIM, cashRequired: false, cashAccounts: [] }).items.map((i) => ({ ...i, checked: true }));
    view(H({ interimReport: INTERIM, cashRequired: false, cashAccounts: [], items: all }));
    const protocol = screen.getByTestId('handover-protocol');
    expect(protocol.querySelector('[data-slot="form-card"]')).toBeNull();
    const bar = protocol.querySelector<HTMLElement>('[data-slot="form-action-bar"]')!;
    for (const id of ['handover-items-save', 'handover-print', 'handover-scan']) expect(within(bar).getByTestId(id)).toBeTruthy();
    expect(primary(within(bar).getByTestId('handover-scan'))).toBe(true);
    // Ein Haken ab: ungespeichert, also wieder `outline`.
    fireEvent.click(within(screen.getAllByTestId('handover-item')[0]!).getByRole('checkbox'));
    expect(primary(within(bar).getByTestId('handover-scan'))).toBe(false);
    cleanup();
    view(H({ interimReport: INTERIM, cashRequired: false, cashAccounts: [] }));
    expect(primary(screen.getByTestId('handover-scan'))).toBe(false);
  });

  it('Drucken mit ungespeicherten Punkten: Satz davor, Knopf gesperrt', async () => {
    view(H({ interimReport: INTERIM, cashRequired: false, cashAccounts: [] }));
    expect(screen.getByTestId('handover-print').hasAttribute('disabled')).toBe(false);
    fireEvent.click(within(screen.getAllByTestId('handover-item')[1]!).getByRole('checkbox'));
    expect(screen.getByTestId('handover-print').hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('handover-print-unsaved')).toBeTruthy();
  });

  it('Schlussdurchsicht I3/I4: Ablehnungen beim Scan und beim Speichern der Punkte stehen da; Zählen nur mit dem Recht zum Festschreiben', async () => {
    vi.mocked(actions.saveHandoverItemsAction).mockResolvedValueOnce({ status: 'error', message: 'Ein eigener Punkt braucht einen Namen.', fieldErrors: { 'items.3.label': 'required' } });
    view(H({ interimReport: INTERIM, cashRequired: false, cashAccounts: [] }));
    fireEvent.click(screen.getByTestId('handover-item-add'));
    fireEvent.click(screen.getByTestId('handover-items-save'));
    expect(await screen.findByText('Ein eigener Punkt braucht einen Namen.')).toBeTruthy();
    fireEvent.click(screen.getByTestId('handover-scan'));
    const dialog = await screen.findByTestId('handover-scan-dialog');
    fireEvent.change(dialog.querySelector('input[type="file"]')!, { target: { files: [new File(['%PDF-1.4 x'], 'p.pdf', { type: 'application/pdf' })] } });
    fireEvent.click(within(dialog).getByRole('button', { name: m('finance.closing.handover.scanDialog.save') }));
    expect(await within(dialog).findByText('Die Datei ist kein PDF.')).toBeTruthy();
    cleanup();
    view(H({ interimReport: INTERIM }), true, false);
    expect(screen.queryByTestId('handover-count')).toBeNull();
    expect(screen.getByText(m('finance.closing.handover.cash.noRight'))).toBeTruthy();
  });

  it('⋯: „Angaben ändern …“ nur bis zum Zwischenbericht; ohne Recht kein ⋯ und keine Knöpfe', async () => {
    view(H());
    fireEvent.click(screen.getByRole('button', { name: m('common.moreActions') }));
    expect(await screen.findByText(m('finance.closing.handover.more.edit'))).toBeTruthy();
    cleanup();
    view(H({ interimReport: INTERIM }));
    fireEvent.click(screen.getByRole('button', { name: m('common.moreActions') }));
    expect(await screen.findByText(m('finance.closing.handover.more.cancel'))).toBeTruthy();
    expect(screen.queryByText(m('finance.closing.handover.more.edit'))).toBeNull();
    cleanup();
    view(H(), false);
    expect(screen.queryByRole('button', { name: m('common.moreActions') })).toBeNull();
    expect(screen.queryByTestId('handover-interim')).toBeNull();
  });

  it('Daran denken: Registeranmeldung nur, wenn die Satzung das Amt nicht ausdrücklich ausnimmt', () => {
    view(H({ statutoryBoard: null }));
    expect(screen.getByTestId('handover-register')).toBeTruthy();
    cleanup();
    view(H({ statutoryBoard: false }));
    expect(screen.queryByTestId('handover-register')).toBeNull();
    expect(screen.getByTestId('handover-remember').textContent).toContain('Anna Berger');
  });

  it('erledigt: „Fertig.“ mit Tag, Protokoll und Kasse', () => {
    view(H({ state: 'done', interimReport: INTERIM, cashAccounts: [{ accountId: 'k1', name: 'Barkasse', bookCents: 31240, count: { countId: 'k', countedCents: 31240, differenceCents: 0 } }], protocolDocumentId: 'd1', doneCount: 3 }));
    const status = screen.getAllByRole('status').find((s) => s.textContent?.includes('312,40'));
    expect(status?.textContent).toContain('30.06.2026');
    // Zugeklappt wie im Jahresabschluss; Schritt 3 verweist auf das Protokoll in der Akte.
    expect(screen.getByTestId('handover-steps-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('handover-protocol-link').getAttribute('href')).toBe('/dms/d1');
  });
});

describe('Amtsübergabe beginnen', () => {
  it('„Von“ kommt als Vorschlag aus der Kontaktrolle, Herkunft grau; „Beginnen“ führt auf die Seite', async () => {
    wrap(<HandoverStartDialog open onOpenChange={() => undefined} today="2026-06-30" canCreateContact={false} />);
    const dialog = await screen.findByTestId('handover-start-dialog');
    await waitFor(() => expect(within(dialog).getByText(m('finance.closing.handover.startDialog.fromSuggested'))).toBeTruthy());
    expect(actions.handoverDefaultsAction).toHaveBeenCalledWith('2026-06-30');
    fireEvent.click(within(dialog).getByRole('button', { name: m('finance.closing.handover.startDialog.save') }));
    await waitFor(() => expect(actions.startHandoverAction).toHaveBeenCalledWith({ handoverOn: '2026-06-30', fromContactId: 'c1', toContactId: '' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/finance/closing/handover/h9'));
  });
  it('ein von Hand geleertes „Von“ füllt sich nicht wieder mit dem Vorschlag', async () => {
    wrap(<HandoverStartDialog open onOpenChange={() => undefined} today="2026-06-30" canCreateContact={false} />);
    const dialog = await screen.findByTestId('handover-start-dialog');
    const picked = () => dialog.querySelector<HTMLInputElement>('input[name="fromContactId"]')!.value;
    await waitFor(() => expect(picked()).toBe('c1'));
    fireEvent.change(within(dialog).getAllByRole('combobox')[0]!, { target: { value: '' } });
    await waitFor(() => expect(picked()).toBe(''));
    await new Promise((r) => setTimeout(r, 50));
    expect(picked()).toBe('');
    expect(actions.handoverDefaultsAction).toHaveBeenCalledTimes(1);
  });
});
