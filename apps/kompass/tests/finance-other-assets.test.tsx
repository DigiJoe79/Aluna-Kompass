// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

const saveOtherAssetAction = vi.fn();
const revalueOtherAssetAction = vi.fn();
const endOtherAssetAction = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/app/(shell)/finance/other-assets/actions', () => ({ saveOtherAssetAction, revalueOtherAssetAction, endOtherAssetAction }));
vi.mock('@/app/(shell)/dms/search-action', () => ({ searchDocumentsAction: vi.fn(async () => []) }));
const { OtherAssetList } = await import('@/app/(shell)/finance/other-assets/other-asset-list');
afterEach(cleanup);
beforeEach(() => {
  saveOtherAssetAction.mockReset();
  revalueOtherAssetAction.mockReset();
  endOtherAssetAction.mockReset();
});

const m = (path: string) => path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], messages) as string;
type Props = React.ComponentProps<typeof OtherAssetList>;
const asset = (over: Partial<Props['rows'][number]> = {}): Props['rows'][number] => ({
  id: 'a1', kind: 'asset', label: '12 Transportboxen', valueCents: 108000, basis: 'Rechnung', recordedFrom: '2023-05-02', recordedUntil: null, endReason: null, documentId: 'd1', updatedAt: 'v1', ...over,
});
const base: Props = {
  rows: [asset(), asset({ id: 'a2', label: 'Pavillon für Feste', valueCents: 64000, basis: 'Schätzung', documentId: null }), asset({ id: 'l1', kind: 'liability', label: 'Darlehen, zinslos', valueCents: 150000, basis: 'Vertrag', documentId: null })],
  ended: [asset({ id: 'e1', label: 'Hundeanhänger', valueCents: 35000, recordedFrom: '2022-08-10', recordedUntil: '2025-06-30', endReason: 'Verkauft' })],
  date: '2026-10-24',
  today: '2026-10-24',
  canWrite: true,
  hasAny: true,
};
const list = (over: Partial<Props> = {}) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <OtherAssetList {...base} {...over} />
    </NextIntlClientProvider>,
  );
const menuOf = (name: string) => screen.getByRole('button', { name: m('common.rowActions').replace('{name}', name) });
const openMenu = async (name: string) => {
  fireEvent.click(menuOf(name));
  return (await screen.findByRole('menu')).textContent ?? '';
};

describe('Sonstiges Vermögen: Liste (Board 11e)', () => {
  it('groups assets and liabilities, each with its sum', () => {
    list();
    const groups = screen.getAllByTestId('other-asset-group').map((g) => g.textContent ?? '');
    expect(groups[0]).toContain(m('finance.otherAssets.groups.asset'));
    expect(groups[0]).toContain('1.720,00');
    expect(groups[1]).toContain(m('finance.otherAssets.groups.liability'));
    expect(groups[1]).toContain('1.500,00');
  });

  it('offers edit, new value, end and the voucher only where there is one; reading only the voucher', async () => {
    list();
    const text = await openMenu('12 Transportboxen');
    for (const key of ['edit', 'revalue', 'end', 'document']) expect(text).toContain(m(`finance.otherAssets.menu.${key}`));
    cleanup();
    list();
    expect(await openMenu('Pavillon für Feste')).not.toContain(m('finance.otherAssets.menu.document'));
    cleanup();
    list({ canWrite: false });
    expect(screen.queryByRole('button', { name: m('finance.otherAssets.create') })).toBeNull();
    expect(screen.queryByRole('button', { name: m('common.rowActions').replace('{name}', 'Pavillon für Feste') })).toBeNull();
    const only = await openMenu('12 Transportboxen');
    expect(only).toContain(m('finance.otherAssets.menu.document'));
    expect(only).not.toContain(m('finance.otherAssets.menu.edit'));
  });

  it('keeps ended entries folded below, with view and voucher only', async () => {
    list();
    const folded = document.querySelector('details')!;
    expect(folded.querySelector('summary')!.textContent).toContain(m('finance.otherAssets.ended'));
    expect(folded.open).toBe(false);
    expect(folded.textContent).toContain('Hundeanhänger');
    expect(folded.textContent).toContain(m('common.muted.ended'));
    const text = await openMenu('Hundeanhänger');
    expect(text).toContain(m('finance.otherAssets.menu.view'));
    expect(text).not.toContain(m('finance.otherAssets.menu.edit'));
  });

  it('empty: says what reports write then, and offers to create', () => {
    list({ rows: [], ended: [], hasAny: false });
    expect(document.querySelector('[data-slot="empty-state"]')).not.toBeNull();
    expect(screen.getAllByRole('button', { name: m('finance.otherAssets.create') }).length).toBeGreaterThan(0);
  });
});

describe('Sonstiges Vermögen: Dialoge (Board 11f, 11g)', () => {
  it('creates without the note on reports, edits with it; field errors at the fields', async () => {
    saveOtherAssetAction.mockResolvedValue({ status: 'error', message: 'x', fieldErrors: { basis: 'Pflichtfeld.' } });
    list();
    fireEvent.click(screen.getByRole('button', { name: m('finance.otherAssets.create') }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText(m('finance.otherAssets.dialog.editNote'))).toBeNull();
    fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${m('finance.otherAssets.dialog.label')}`)), { target: { value: 'Kaution Lagerraum' } });
    fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${m('finance.otherAssets.dialog.value')}`)), { target: { value: '300' } });
    fireEvent.click(within(dialog).getByRole('button', { name: m('finance.otherAssets.dialog.create') }));
    await waitFor(() => expect(saveOtherAssetAction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'asset', label: 'Kaution Lagerraum', valueCents: 30000 })));
    expect(await within(dialog).findByText('Pflichtfeld.')).toBeTruthy();
    cleanup();
    list();
    fireEvent.click(menuOf('12 Transportboxen'));
    fireEvent.click(await screen.findByRole('menuitem', { name: m('finance.otherAssets.menu.edit') }));
    expect(within(await screen.findByRole('dialog')).getByText(m('finance.otherAssets.dialog.editNote'))).toBeTruthy();
  });

  it('sends no unreadable or missing value: the error stands at the field and goes with typing', async () => {
    list();
    fireEvent.click(menuOf('Pavillon für Feste'));
    fireEvent.click(await screen.findByRole('menuitem', { name: m('finance.otherAssets.menu.revalue') }));
    const dialog = await screen.findByRole('dialog');
    const value = within(dialog).getByLabelText(new RegExp(`^${m('finance.otherAssets.dialog.value')}`));
    const save = within(dialog).getByRole('button', { name: m('finance.otherAssets.revalue.save') });
    fireEvent.click(save);
    expect(await within(dialog).findByText(m('finance.amount.missing'))).toBeTruthy();
    fireEvent.change(value, { target: { value: '12,3x' } });
    expect(within(dialog).queryByText(m('finance.amount.missing'))).toBeNull();
    fireEvent.click(save);
    expect(await within(dialog).findByText(m('finance.amount.format'))).toBeTruthy();
    expect(revalueOtherAssetAction).not.toHaveBeenCalled();
  });

  it('new value from a day and end with a last day', async () => {
    revalueOtherAssetAction.mockResolvedValue({ status: 'success' });
    list();
    fireEvent.click(menuOf('Pavillon für Feste'));
    fireEvent.click(await screen.findByRole('menuitem', { name: m('finance.otherAssets.menu.revalue') }));
    const dialog = await screen.findByRole('dialog');
    // Ohne „Ab“ steht kein offener Platzhalter (Designer Runde 7, 253); mit „Ab“ das Ende am Vortag.
    expect(within(dialog).getByTestId('other-asset-revalue-before').textContent).not.toContain('…');
    fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${m('finance.otherAssets.revalue.from')}`)), { target: { value: '2027-01-01' } });
    fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${m('finance.otherAssets.dialog.value')}`)), { target: { value: '500' } });
    fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${m('finance.otherAssets.dialog.basis')}`)), { target: { value: 'Schätzung Vorstand' } });
    expect(dialog.textContent).toContain('31.12.2026');
    fireEvent.click(within(dialog).getByRole('button', { name: m('finance.otherAssets.revalue.save') }));
    await waitFor(() => expect(revalueOtherAssetAction).toHaveBeenCalledWith({ id: 'a2', from: '2027-01-01', valueCents: 50000, basis: 'Schätzung Vorstand' }));
    cleanup();
    endOtherAssetAction.mockResolvedValue({ status: 'success' });
    list();
    fireEvent.click(menuOf('Pavillon für Feste'));
    fireEvent.click(await screen.findByRole('menuitem', { name: m('finance.otherAssets.menu.end') }));
    const end = await screen.findByRole('dialog');
    fireEvent.change(within(end).getByLabelText(new RegExp(`^${m('finance.otherAssets.end.until')}`)), { target: { value: '2026-10-01' } });
    fireEvent.click(within(end).getByRole('button', { name: m('finance.otherAssets.end.save') }));
    await waitFor(() => expect(endOtherAssetAction).toHaveBeenCalledWith({ id: 'a2', until: '2026-10-01', reason: '' }));
  });
});
