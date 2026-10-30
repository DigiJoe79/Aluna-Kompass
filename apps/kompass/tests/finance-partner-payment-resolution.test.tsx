// @vitest-environment jsdom
import type { PartnerPaymentView, PartnerView } from '@kompass/module-finance';
import type { PaymentPeople } from '@/app/(shell)/finance/partners/[id]/payments/[paymentId]/payment-detail';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/app/(shell)/finance/partners/actions', () => ({}));
vi.mock('@/app/(shell)/dms/search-action', () => ({ searchDocumentsAction: vi.fn(async () => []) }));
const { PaymentDetail } = await import('@/app/(shell)/finance/partners/[id]/payments/[paymentId]/payment-detail');
afterEach(cleanup);

const payment = (resolution: PartnerPaymentView['resolution']) =>
  ({
    id: 'pp1', state: 'rejected', basis: 'transfer58', purposeText: 'Futter', retroactive: false, assetEndowment: false, positions: [], paidLines: [], totalCents: 5000,
    activeStep: null, proofDueOn: null, effectiveProofMonths: 6, rejectNote: null, createdAt: '2026-03-01T10:00:00Z', submittedAt: null, approvedAt: null, paidOn: null, acknowledgedAt: null,
    resolutionId: resolution ? 'r1' : null, resolution,
  }) as unknown as PartnerPaymentView;

const show = (resolution: PartnerPaymentView['resolution']) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <PaymentDetail payment={payment(resolution)} partner={{} as PartnerView} canWrite={false} canApprove={false} categories={[]} purposes={[]} projects={[]} paidLineOptions={[]} goodsLineOptions={[]} evidence={[]} agreementDocument={null} today="2026-10-29" people={{ creator: 'Anna', approver: null, acknowledger: null, acknowledgers: [], viewerIsCreator: false } as PaymentPeople} />
    </NextIntlClientProvider>,
  );

describe('Zahlung an Partner: Beschluss aus Gremien (G7)', () => {
  it('names the resolution with its link; without one (or without Gremien) nothing', () => {
    show({ label: 'Beschluss B-2026-003', href: '/governance/resolutions/r1' });
    expect(screen.getByRole('link', { name: 'Beschluss B-2026-003' }).getAttribute('href')).toBe('/governance/resolutions/r1');
    cleanup();
    show(null);
    expect(screen.queryByTestId('payment-resolution')).toBeNull();
  });
});
