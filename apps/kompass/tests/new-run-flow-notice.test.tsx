// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DirectDebitPreview, DirectDebitPreviewItem } from '@kompass/module-finance';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NewRunFlow } from '@/app/(shell)/finance/direct-debit/runs/new/new-run-flow';
import { DateFormatProvider } from '@/components/date-format-provider';
import messages from '../messages/de.json';

const actions = vi.hoisted(() => ({ previewRunAction: vi.fn(), createRunAction: vi.fn(), issueNoticeAction: vi.fn() }));
vi.mock('@/app/(shell)/finance/direct-debit/actions', () => actions);
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <DateFormatProvider mode="locale" timeZone="Europe/Berlin">{children}</DateFormatProvider>
    </NextIntlClientProvider>
  );
}

const item = (sourceId: string): DirectDebitPreviewItem => ({
  source: 'openItem',
  sourceId,
  installmentOn: null,
  mandateId: `M-${sourceId}`,
  mandateReference: `REF-${sourceId}`,
  mandateState: 'active',
  contactId: 'C1',
  debtorName: `Person ${sourceId}`,
  amountCents: 1000,
  dueOn: '2026-11-02',
  remittance: 'Beitrag 2026',
  coverOn: '2026-11-16',
});

const preview: DirectDebitPreview = {
  collectionDate: '2026-11-16',
  accountId: 'A1',
  noticeCoversFrom: '2026-11-20',
  submitFrom: '2026-11-02',
  submitBy: '2026-11-13',
  noticeLateCoveredOn: null,
  missedRates: [],
  included: [],
  excluded: [{ reason: 'noticeLate', items: [item('1'), item('2')] }],
  totals: { count: 0, sumCents: 0 },
};

describe('Neuer Einzug — „Ankündigung erzeugen“ (App-B1)', () => {
  it('ein Doppelklick stellt eine Ankündigung aus; solange sie läuft, sind alle Ankündigungs-Knöpfe der Liste gesperrt', async () => {
    actions.previewRunAction.mockResolvedValue({ status: 'success', data: preview });
    let resolve!: (v: unknown) => void;
    actions.issueNoticeAction.mockImplementation(() => new Promise((res) => (resolve = res)));
    render(<NewRunFlow days={['2026-11-16']} accounts={[{ id: 'A1', name: 'Giro' }]} defaultAccountId="A1" canCreate={false} />, { wrapper });
    await act(async () => {
      fireEvent.click(screen.getByTestId('run-show-preview'));
    });
    const buttons = screen.getAllByRole('button', { name: 'Ankündigung erzeugen' });
    expect(buttons).toHaveLength(2);
    await act(async () => {
      fireEvent.click(buttons[0]!);
      fireEvent.click(buttons[0]!);
    });
    expect(actions.issueNoticeAction).toHaveBeenCalledTimes(1);
    for (const b of screen.getAllByRole('button', { name: 'Ankündigung erzeugen' })) {
      expect((b as HTMLButtonElement).disabled).toBe(true);
      expect(b.getAttribute('aria-busy')).toBe('true');
    }
    await act(async () => {
      resolve({ status: 'success' });
    });
    const rest = screen.getAllByRole('button', { name: 'Ankündigung erzeugen' });
    expect(rest).toHaveLength(1);
    expect((rest[0] as HTMLButtonElement).disabled).toBe(false);
  });
});
