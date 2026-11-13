// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

const actions = vi.hoisted(() => ({ assignablePaymentsAction: vi.fn(), assignPaymentAction: vi.fn(), unassignPaymentAction: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/(shell)/finance/open-items/actions', () => actions);
const { AssignPaymentDialog } = await import('@/app/(shell)/finance/open-items/assign-payment-dialog');
afterEach(cleanup);
beforeEach(() => {
  Object.values(actions).forEach((a) => a.mockReset());
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});

const wrap = (node: React.ReactNode) => render(<NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">{node}</NextIntlClientProvider>);
const candidate = (id: string, over: Record<string, unknown> = {}) => ({
  moneyLineId: id, entryId: `E-${id}`, entryNumber: `B-2026-${id}`, entryDate: '2026-02-14', accountId: 'A', entryText: 'Beitrag', categoryIds: ['K'], lineCents: 6000, freeCents: 6000, assignedTo: [],
  purpose: null, payerContactId: 'C', viaGuardian: false, categoryFits: true, amountFits: true, purposeHint: null, blockedBy: null, blockedParams: null,
  categoryLabel: 'Mitgliedsbeiträge', accountName: 'Girokonto', payerName: 'Jonas Keller', assignedToLabels: [], blockedText: null, blockedLink: null, ...over,
});
const data = (candidates: unknown[], item: Record<string, unknown> = {}) => ({
  status: 'success',
  data: { item: { id: 'I1', contactLabel: 'Jonas Keller', paymentReference: 'Beitrag 2026', amountCents: 6000, openCents: 6000, dueOn: '2026-03-31', draftSettlementCents: 0, ...item }, candidates },
});
const radios = () => screen.getAllByRole('radio');
const open = () => wrap(<AssignPaymentDialog openItemIds={['I1']} open onOpenChange={() => undefined} today="2026-11-12" />);

describe('AssignPaymentDialog (Design 1a–2e)', () => {
  it('preselects the first selectable line and puts the focus there; a blocked line cannot be chosen', async () => {
    actions.assignablePaymentsAction.mockResolvedValue(data([candidate('1', { freeCents: 3000, amountFits: false }), candidate('2'), candidate('3', { blockedBy: 'assignCategoryMismatch', blockedText: 'Als Spende gebucht.' })]));
    open();
    await waitFor(() => expect(radios()).toHaveLength(3));
    expect(radios()[0]!.getAttribute('aria-checked')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(radios()[0]));
    expect(radios()[2]!.hasAttribute('data-disabled') || radios()[2]!.getAttribute('aria-disabled') === 'true').toBe(true);
    fireEvent.click(radios()[2]!);
    expect(radios()[2]!.getAttribute('aria-checked')).toBe('false');
    expect(radios()[0]!.getAttribute('aria-checked')).toBe('true');
  });

  it('refuses an amount above the smaller of open and free before sending', async () => {
    actions.assignablePaymentsAction.mockResolvedValue(data([candidate('1', { freeCents: 3000 })]));
    open();
    const field = (await screen.findByRole('textbox')) as HTMLInputElement;
    expect(field.value).toBe('30,00');
    fireEvent.change(field, { target: { value: '30,01' } });
    fireEvent.click(screen.getByTestId('assign-payment-save'));
    await waitFor(() => expect(field.getAttribute('aria-invalid')).toBe('true'));
    expect(actions.assignPaymentAction).not.toHaveBeenCalled();
  });

  it('a refusal stays in the footer; dialog and choice stay', async () => {
    actions.assignablePaymentsAction.mockResolvedValue(data([candidate('1'), candidate('2')]));
    actions.assignPaymentAction.mockResolvedValue({ status: 'error', message: 'Der Posten steckt in einem eingereichten Lastschrift-Einzug.', fieldErrors: {} });
    open();
    await waitFor(() => expect(radios()).toHaveLength(2));
    fireEvent.click(radios()[1]!);
    fireEvent.click(screen.getByTestId('assign-payment-save'));
    await waitFor(() => expect(actions.assignPaymentAction).toHaveBeenCalledWith({ openItemId: 'I1', moneyLineId: '2', amountCents: 6000 }));
    expect(await screen.findByText(/eingereichten Lastschrift-Einzug/)).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(radios()[1]!.getAttribute('aria-checked')).toBe('true');
  });

  it('without candidates the empty state offers booking and nothing can be assigned', async () => {
    actions.assignablePaymentsAction.mockResolvedValue(data([]));
    open();
    await waitFor(() => expect(screen.getByTestId('assign-payment-save').hasAttribute('disabled')).toBe(true));
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });
});
