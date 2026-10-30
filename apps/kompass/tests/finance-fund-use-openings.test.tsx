// @vitest-environment jsdom
import type { FundsUseOpeningsOverview, FundsUseOpeningView } from '@kompass/module-finance';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

const saveFundsUseOpeningAction = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }), usePathname: () => '/finance/fund-use' }));
vi.mock('@/app/(shell)/finance/fund-use/actions', () => ({ saveFundsUseOpeningAction }));
vi.mock('@/app/(shell)/dms/search-action', () => ({ searchDocumentsAction: vi.fn(async () => []) }));
const { OpeningHeaderActions, OpeningsSection } = await import('@/app/(shell)/finance/fund-use/openings-section');
afterEach(cleanup);
beforeEach(() => saveFundsUseOpeningAction.mockReset());

const m = (path: string) => path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], messages) as string;
const wrap = (node: React.ReactNode) => render(<NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">{node}</NextIntlClientProvider>);

const opening = (over: Partial<FundsUseOpeningView> = {}): FundsUseOpeningView => ({
  id: 'o1',
  offset: 1,
  designation: '2022',
  endsOn: '2022-12-31',
  revenueCents: 15_000_000,
  amountCents: 300_000,
  limitCents: 10_000_000,
  effectiveCents: 300_000,
  zeroReason: null,
  dueBy: '2024-12-31',
  documentId: 'd1',
  updatedAt: '2026-01-02T10:00:00.000Z',
  ...over,
});
const overview = (over: Partial<FundsUseOpeningsOverview> = {}): FundsUseOpeningsOverview => ({
  firstFiscalYear: { id: 'y23', designation: '2023', startsOn: '2023-01-01' },
  changeable: true,
  expectedEndsOn: { offset1: '2022-12-31' },
  openings: [],
  ...over,
});
const ADD = () => m('finance.fundUse.openings.add');
const MORE = () => m('finance.fundUse.openings.addMore');
const EDIT = () => m('finance.fundUse.openings.edit');
const menu = () => screen.queryByRole('button', { name: m('common.moreActions') });

async function openHeaderEntry() {
  fireEvent.click(menu()!);
  fireEvent.click(await screen.findByRole('menuitem', { name: ADD() }));
}

describe('Anfangsvortrag im ⋯ des Kopfs (Plan U2 Task 3)', () => {
  it('offers the entry only in the first year, with the right, while there is none', () => {
    wrap(<OpeningHeaderActions overview={overview()} yearId="y23" canEdit />);
    expect(menu()).not.toBeNull();
    cleanup();
    wrap(<OpeningHeaderActions overview={overview()} yearId="y24" canEdit />);
    expect(menu()).toBeNull();
    cleanup();
    wrap(<OpeningHeaderActions overview={overview()} yearId="y23" canEdit={false} />);
    expect(menu()).toBeNull();
    cleanup();
    wrap(<OpeningHeaderActions overview={overview({ openings: [opening()] })} yearId="y23" canEdit />);
    expect(menu()).toBeNull();
  });

  it('first year closed: the entry stays and the dialog names the reason (Review Focus 3)', async () => {
    wrap(<OpeningHeaderActions overview={overview({ changeable: false })} yearId="y23" canEdit />);
    await openHeaderEntry();
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('alert').textContent).toContain('2023');
    expect(within(dialog).queryByLabelText(new RegExp(m('finance.fundUse.openings.dialog.amount')))).toBeNull();
  });

  it('opens the dialog for the year right before Kompass, never the one before it first', async () => {
    wrap(<OpeningHeaderActions overview={overview()} yearId="y23" canEdit />);
    await openHeaderEntry();
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain(m('finance.fundUse.openings.dialog.offset1'));
    expect((within(dialog).getByLabelText(new RegExp(m('finance.fundUse.openings.dialog.endsOn'))) as HTMLInputElement).value).toBe('2022-12-31');
  });

  it('empty amounts are field errors, no action', async () => {
    wrap(<OpeningHeaderActions overview={overview()} yearId="y23" canEdit />);
    await openHeaderEntry();
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByTestId('voucher-file-input'), { target: { files: [new File(['%PDF-1.4'], 'beleg.pdf', { type: 'application/pdf' })] } });
    fireEvent.click(within(dialog).getByRole('button', { name: m('finance.fundUse.openings.dialog.save') }));
    expect(await within(dialog).findAllByText(m('finance.amount.missing'))).toHaveLength(2);
    expect(saveFundsUseOpeningAction).not.toHaveBeenCalled();
  });

  it('saves with offset, cents and exactly one of document or file; a service field error stands at its field', async () => {
    saveFundsUseOpeningAction.mockResolvedValueOnce({ status: 'error', message: 'x', fieldErrors: { amountCents: 'Vortrag zu hoch' } });
    wrap(<OpeningHeaderActions overview={overview()} yearId="y23" canEdit />);
    await openHeaderEntry();
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(new RegExp(m('finance.fundUse.openings.dialog.revenue'))), { target: { value: '150.000,00' } });
    fireEvent.change(within(dialog).getByLabelText(new RegExp(m('finance.fundUse.openings.dialog.amount'))), { target: { value: '3.000,00' } });
    fireEvent.change(within(dialog).getByTestId('voucher-file-input'), { target: { files: [new File(['%PDF-1.4'], 'beleg.pdf', { type: 'application/pdf' })] } });
    fireEvent.click(within(dialog).getByRole('button', { name: m('finance.fundUse.openings.dialog.save') }));
    await waitFor(() => expect(saveFundsUseOpeningAction).toHaveBeenCalledTimes(1));
    const form = saveFundsUseOpeningAction.mock.calls[0]![0] as FormData;
    expect(form.get('offset')).toBe('1');
    expect(form.get('designation')).toBe('2022');
    expect(form.get('revenueCents')).toBe('15000000');
    expect(form.get('amountCents')).toBe('300000');
    expect(form.get('file')).toBeInstanceOf(File);
    expect(form.get('documentId')).toBeNull();
    const amount = within(dialog).getByLabelText(new RegExp(m('finance.fundUse.openings.dialog.amount')));
    await waitFor(() => expect(amount.getAttribute('aria-invalid')).toBe('true'));
    expect(dialog.textContent).toContain('Vortrag zu hoch');
  });
});

describe('Abschnitt „Anfangsvortrag“', () => {
  it('does not show without openings', () => {
    const { container } = wrap(<OpeningsSection overview={overview()} canEdit documents={{}} />);
    expect(container.textContent).toBe('');
  });

  it('one opening: edit per row and one more; two: no more', () => {
    wrap(<OpeningsSection overview={overview({ openings: [opening()] })} canEdit documents={{ d1: 'BEL-2023-001' }} />);
    expect(screen.getByRole('heading', { name: m('finance.fundUse.openings.title') })).toBeTruthy();
    expect(screen.getByText(/BEL-2023-001/)).toBeTruthy();
    expect(screen.getByRole('button', { name: MORE() })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: new RegExp(m('common.rowActions').split('{')[0]!) })).toHaveLength(1);
    cleanup();
    wrap(<OpeningsSection overview={overview({ openings: [opening(), opening({ id: 'o2', offset: 2, designation: '2021', endsOn: '2021-12-31', effectiveCents: 0, zeroReason: 'belowLimit' })] })} canEdit documents={{}} />);
    expect(screen.queryByRole('button', { name: MORE() })).toBeNull();
  });

  it('first year closed: „Bearbeiten …“ and „Weiteren Vortrag erfassen …“ stay and name the reason (MUSTER „Keine Sperre ohne Grund“)', async () => {
    wrap(<OpeningsSection overview={overview({ changeable: false, openings: [opening()] })} canEdit documents={{}} />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(m('common.rowActions').split('{')[0]!) }));
    fireEvent.click(await screen.findByRole('menuitem', { name: EDIT() }));
    let dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('alert').textContent).toContain('2023');
    expect(within(dialog).queryByLabelText(new RegExp(m('finance.fundUse.openings.dialog.amount')))).toBeNull();
    cleanup();
    wrap(<OpeningsSection overview={overview({ changeable: false, openings: [opening()] })} canEdit documents={{}} />);
    fireEvent.click(screen.getByRole('button', { name: MORE() }));
    dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('alert').textContent).toContain('2023');
  });

  it('closing the edit dialog returns the focus to the row menu', async () => {
    wrap(<OpeningsSection overview={overview({ openings: [opening()] })} canEdit documents={{}} />);
    const trigger = screen.getByRole('button', { name: new RegExp(m('common.rowActions').split('{')[0]!) });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('menuitem', { name: EDIT() }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: m('common.cancel') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('without the right: no row menu', () => {
    wrap(<OpeningsSection overview={overview({ openings: [opening()] })} canEdit={false} documents={{}} />);
    expect(screen.queryByRole('button', { name: new RegExp(m('common.rowActions').split('{')[0]!) })).toBeNull();
  });

  it('edits the row it belongs to', async () => {
    wrap(<OpeningsSection overview={overview({ openings: [opening()] })} canEdit documents={{}} />);
    const trigger = screen.getByRole('button', { name: new RegExp(m('common.rowActions').split('{')[0]!) });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('menuitem', { name: EDIT() }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain(m('finance.fundUse.openings.dialog.editTitle'));
    expect((within(dialog).getByLabelText(new RegExp(m('finance.fundUse.openings.dialog.amount'))) as HTMLInputElement).value).toBe('3.000,00');
  });
});
