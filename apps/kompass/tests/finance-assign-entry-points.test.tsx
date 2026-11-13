// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

const openItemActions = vi.hoisted(() => ({ assignablePaymentsAction: vi.fn(), assignPaymentAction: vi.fn(), unassignPaymentAction: vi.fn(), cancelOpenItemAction: vi.fn(), saveOpenItemAction: vi.fn() }));
const dmsActions = vi.hoisted(() => ({ addNoteAction: vi.fn(), createResponseDraftAction: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => '/finance/open-items', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/app/(shell)/finance/open-items/actions', () => openItemActions);
vi.mock('@/app/(shell)/dms/actions', () => dmsActions);
vi.mock('@/app/(shell)/members/actions', () => ({ startDunningRunAction: vi.fn() }));
vi.mock('@/app/(shell)/contacts/search-action', () => ({ searchContactsAction: vi.fn(async () => ({ items: [], more: false })) }));
const { DetailSheet } = await import('@/app/(shell)/finance/open-items/detail-sheet');
const { DunningRunFlow } = await import('@/app/(shell)/members/fees/dunning/dunning-run-flow');
afterEach(cleanup);
beforeEach(() => {
  [...Object.values(openItemActions), ...Object.values(dmsActions)].forEach((a) => a.mockReset());
  openItemActions.assignablePaymentsAction.mockResolvedValue({ status: 'success', data: { item: { id: 'I1', contactLabel: 'Jonas Keller', paymentReference: 'Beitrag 2026', amountCents: 6000, openCents: 6000, dueOn: '2026-03-31', draftSettlementCents: 0 }, candidates: [] } });
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});

const m = (path: string) => path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], messages) as string;
const wrap = (node: React.ReactNode) => render(<NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">{node}</NextIntlClientProvider>);
const item = (over: Record<string, unknown> = {}) => ({ id: 'I1', expectedVersion: 'v', kind: 'receivable' as const, itemDate: '2026-03-01', contactId: 'C', contactLabel: 'Jonas Keller', amountCents: 6000, openCents: 6000, dueOn: '2026-03-31', paymentReference: 'Beitrag 2026', originType: null, originId: null, cancelledAt: null, draftSettlementCents: 0, ...over });
const sheet = (props: Record<string, unknown> = {}) => wrap(<DetailSheet item={item()} settlements={[]} canWrite canFinalize finalizeNames={[]} canCreateContact={false} today="2026-11-12" {...props} />);
const trigger = () => screen.queryByRole('button', { name: m('finance.openItems.assign.trigger') });

describe('„Zahlung zuordnen …“ am offenen Posten (Design 3a, 4a, 2h)', () => {
  it('only for an open receivable and with the right to write entries', () => {
    sheet();
    expect(trigger()).toBeTruthy();
    cleanup();
    sheet({ item: item({ kind: 'payable' }) });
    expect(trigger()).toBeNull();
    cleanup();
    sheet({ canWrite: false });
    expect(trigger()).toBeNull();
    cleanup();
    sheet({ item: item({ openCents: 2000 }) });
    fireEvent.click(trigger()!);
    return waitFor(() => expect(openItemActions.assignablePaymentsAction).toHaveBeenCalledWith('I1'));
  });

  it('a menu only at a later assignment; with a return the entry names its reason', () => {
    sheet({
      item: item({ openCents: 0 }),
      settlements: [
        { entryId: 'E1', entryNumber: 'B-1', amountCents: 3000, entryDate: '2026-02-14', settlementId: 'S1', moneyLineId: 'M1', assignedAt: null, unassignable: false, unassignBlockedBy: null },
        { entryId: 'E2', entryNumber: 'B-2', amountCents: 3000, entryDate: '2026-02-15', settlementId: 'S2', moneyLineId: 'M2', assignedAt: '2026-11-12T09:00:00.000Z', unassignable: false, unassignBlockedBy: 'assignmentHasReturn' },
      ],
    });
    const rows = screen.getAllByTestId('settled-by-row');
    expect(within(rows[0]!).queryByRole('button')).toBeNull();
    expect(within(rows[1]!).getByRole('button')).toBeTruthy();
  });

  it('an unfounded reminder shows two buttons, one once the note is written', () => {
    sheet({ unfoundedNotices: [{ documentId: 'D1', sentOn: '2026-05-05', paymentDate: '2026-02-14', noted: false, notedOn: null }] });
    const notice = screen.getByTestId('unfounded-notice');
    expect(within(notice).getAllByRole('button')).toHaveLength(2);
    cleanup();
    sheet({ unfoundedNotices: [{ documentId: 'D1', sentOn: '2026-05-05', paymentDate: '2026-02-14', noted: true, notedOn: '2026-11-12' }] });
    expect(within(screen.getByTestId('unfounded-notice')).getAllByRole('button')).toHaveLength(1);
  });

  it('„Vermerk an den Mahnbrief“ writes the note on the letter', async () => {
    dmsActions.addNoteAction.mockResolvedValue({ status: 'success' });
    sheet({ unfoundedNotices: [{ documentId: 'D1', sentOn: '2026-05-05', paymentDate: '2026-02-14', noted: false, notedOn: null }] });
    fireEvent.click(screen.getByTestId('unfounded-note'));
    await waitFor(() => expect(dmsActions.addNoteAction).toHaveBeenCalledWith('D1', { status: 'idle' }, expect.any(FormData)));
    expect(String((dmsActions.addNoteAction.mock.calls[0]![2] as FormData).get('body'))).toContain('14.02.2026');
  });
});

describe('„Zuordnen …“ im Mahnlauf (Design 3c)', () => {
  const candidate = { membershipId: 'MS', memberNumber: 'M-0012', name: 'Jonas Keller', levelKey: 'reminder', levelName: 'Erinnerung', chargeIds: ['C1'], sumCents: 6000, returnedOn: null };
  const flow = (match: Record<string, unknown>) =>
    wrap(<DunningRunFlow asOf="2026-11-12" today="2026-11-12" preview={{ asOf: '2026-11-12', ready: [], skipped: [], paymentMayMatch: [{ ...candidate, ...match }] } as never} paymentTermDays={14} levels={[{ key: 'reminder', last: false }]} canStart canAssign />);

  it('opens the dialog with booked payments, otherwise links to the work list', async () => {
    flow({ rawTransactionIds: [], bookedPayments: [{ openItemId: 'I1', moneyLineId: 'M1' }] });
    fireEvent.click(screen.getByTestId('dunning-assign'));
    await waitFor(() => expect(openItemActions.assignablePaymentsAction).toHaveBeenCalledWith('I1'));
    cleanup();
    flow({ rawTransactionIds: ['R1'], bookedPayments: [] });
    expect(screen.queryByTestId('dunning-assign')).toBeNull();
    expect(screen.getByRole('link', { name: m('members.dunningRun.assign') }).getAttribute('href')).toBe('/finance/work');
  });
});

describe('„Zahlung zuordnen …“ an der Beitragszeile (Design 3b)', () => {
  it('is the first entry; greyed with its reason while the fee is pending', async () => {
    vi.doMock('@/app/(shell)/members/actions', () => ({ deferChargeAction: vi.fn(), waiveChargeAction: vi.fn(), startDunningRunAction: vi.fn() }));
    const { FeeList } = await import('@/app/(shell)/members/fees/fee-list');
    const fee = { chargeId: 'F1', membershipId: 'MS', memberNumber: 'M-1', name: 'Jonas Keller', typeId: 'T', periodStart: '2027-01-01', periodEnd: '2027-12-31', period: '2027', amountCents: 6000, dueOn: '2027-01-01', deferredTo: null, openItemId: null, waivedCents: 0, dunningLevel: null, dunningLevelBeforeDeferral: null, paidOn: null, paymentMethod: 'transfer', unfoundedNotices: [], state: 'open', overdue: false, openCents: 6000, paidCents: 0 };
    wrap(<FeeList year={2027} years={[2027]} rows={[fee as never]} total={1} unfiltered={1} offset={0} pageSize={50} totals={{ dueCents: 6000, paidCents: 0, openCents: 6000, dunnedCents: 0 }} exempt={[]} types={[{ id: 'T', name: 'Ordentlich' }]} levels={[]} canFees canAssign today="2026-11-12" />);
    fireEvent.click(screen.getByRole('button', { name: /Jonas Keller/ }));
    const items = await screen.findAllByRole('menuitem');
    expect(items[0]!.textContent).toContain(m('finance.openItems.assign.trigger'));
    expect(items[0]!.textContent).toContain(m('finance.openItems.assign.menuDisabled.pending'));
    expect(items[0]!.getAttribute('aria-disabled') === 'true' || items[0]!.hasAttribute('data-disabled')).toBe(true);
  });
});
