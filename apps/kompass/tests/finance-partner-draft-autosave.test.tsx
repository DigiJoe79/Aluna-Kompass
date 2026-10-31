// @vitest-environment jsdom
import type { PartnerPaymentView, PartnerView } from '@kompass/module-finance';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateFormatProvider } from '@/components/date-format-provider';
import messages from '../messages/de.json';

const actions = vi.hoisted(() => ({ savePartnerPaymentDraftAction: vi.fn(), submitPartnerPaymentAction: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/app/(shell)/finance/partners/actions', () => actions);
vi.mock('@/app/(shell)/dms/search-action', () => ({ searchDocumentsAction: vi.fn(async () => []) }));
const { DraftForm } = await import('@/app/(shell)/finance/partners/[id]/payments/[paymentId]/draft-form');
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const payment = {
  id: 'pp1', partnerId: 'p1', version: '1', state: 'draft', basis: 'transfer58', basisOverrideReason: null, purposeText: 'Futter', retroactive: false, assetEndowment: false, proofMonths: null, paidLines: [],
  positions: [{ kind: 'money', amountCents: 5000, categoryId: 'c1', purposeId: null, projectId: null, goodsLineId: null, note: null }],
  reasonsNeeded: { notice: false, overdue: false, purpose: false },
} as unknown as PartnerPaymentView;

const show = () =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <DateFormatProvider mode="locale" timeZone="Europe/Berlin">
        <DraftForm payment={payment} partner={{ id: 'p1', status: 'taxExemptBody', usualBasis: 'transfer58', usualProofMonths: 6 } as unknown as PartnerView} canWrite categories={[]} purposes={[]} projects={[]} paidLineOptions={[]} goodsLineOptions={[]} agreementDocument={null} today="2026-10-29" />
      </DateFormatProvider>
    </NextIntlClientProvider>,
  );

describe('Zahlung an Partner: laufendes Sichern', () => {
  it('speichert einen unlesbaren Betrag nicht als „kein Betrag“, sondern sagt es am Feld und in der Leiste', async () => {
    show();
    fireEvent.change(screen.getByRole('textbox', { name: messages.finance.partners.payment.positions.amount }), { target: { value: '12,3x' } });
    await waitFor(() => expect(screen.getByTestId('save-status').textContent).toContain(messages.finance.amount.format), { timeout: 2000 });
    expect(actions.savePartnerPaymentDraftAction).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: messages.finance.partners.payment.positions.amount }).getAttribute('aria-invalid')).toBe('true');
  });
});
