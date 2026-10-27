// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/app/(shell)/contacts/search-action', () => ({ searchContactsAction: vi.fn(async () => []) }));
const { SplitRow } = await import('@/components/finance/split-row');
afterEach(cleanup);

// Testing Library faltet Leerraum im DOM (auch das geschützte Leerzeichen nach „§“), den Suchtext nicht — hier ebenso.
const m = (path: string) => (path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], messages) as string).replace(/\s/g, ' ');
const categories = [
  { id: 'grant', name: 'Zuwendungen anderer Organisationen', direction: 'income' as const, sphere: 'ideal', incomeKind: 'bodyGrant' },
  { id: 'heir', name: 'Erbschaften', direction: 'income' as const, sphere: 'ideal', incomeKind: 'inheritance' },
  { id: 'don', name: 'Spenden', direction: 'income' as const, sphere: 'ideal', incomeKind: 'donation' },
];
const base = { key: 'r1', amountText: '500,00', contactId: null, projectId: null, purposeId: null, abroad: false, addsToAssets: false };
const show = (categoryId: string, over: Record<string, unknown> = {}, onChange = vi.fn()) => {
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <SplitRow value={{ ...base, categoryId, ...over }} onChange={onChange} onRemove={vi.fn()} onDuplicate={vi.fn()} onRestHere={vi.fn()} onSplitEvenly={vi.fn()} position={1} restCents={null} categories={categories} purposes={[]} projects={[]} taxCodeOptions={[]} showTax={false} />
    </NextIntlClientProvider>,
  );
  return onChange;
};

describe('Aufteilungszeile: Merkmale der Anlage Gem (15g)', () => {
  it('offers the endowment only for a grant from another body', () => {
    show('grant');
    expect(screen.getByLabelText(m('finance.splitRow.assetEndowment'))).toBeTruthy();
    expect(screen.queryByLabelText(m('finance.splitRow.notToAssets'))).toBeNull();
    cleanup();
    show('don');
    expect(screen.queryByLabelText(m('finance.splitRow.assetEndowment'))).toBeNull();
  });

  it('unticking the addition to assets sets the fixed reason of the kind, no free text', () => {
    const onChange = show('heir');
    expect(screen.queryByRole('textbox', { name: /Grund/ })).toBeNull();
    fireEvent.click(screen.getByLabelText(m('finance.splitRow.notToAssets')));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ addsToAssetsOptOut: 'testatorDirectedCurrentUse', addsToAssets: false }));
    cleanup();
    const onEndowment = show('grant', { assetEndowment: true });
    fireEvent.click(screen.getByLabelText(m('finance.splitRow.notToAssets')));
    expect(onEndowment).toHaveBeenCalledWith(expect.objectContaining({ addsToAssetsOptOut: 'donorAllowedCurrentUse' }));
  });
});

describe('Zahlung an Partner: Vermögensausstattung (15g)', () => {
  it('only for a transfer under § 58 no. 1 to a tax-exempt or public body', async () => {
    const { endowmentAllowed } = await import('@/app/(shell)/finance/partners/[id]/payments/[paymentId]/draft-form');
    expect(endowmentAllowed('transfer58', 'taxExemptBody')).toBe(true);
    expect(endowmentAllowed('transfer58', 'publicBody')).toBe(true);
    expect(endowmentAllowed('transfer58', 'foreignBody')).toBe(false);
    expect(endowmentAllowed('agent57', 'taxExemptBody')).toBe(false);
  });
});
