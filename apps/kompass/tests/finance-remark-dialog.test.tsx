// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

const actions = vi.hoisted(() => ({ createRemarkAction: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/(shell)/finance/audit/actions', () => actions);
const { RemarkDialog } = await import('@/app/(shell)/finance/audit/remark-dialog');
afterEach(cleanup);
beforeEach(() => actions.createRemarkAction.mockReset());

const m = (path: string) => path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], messages) as string;
const open = (paperAuditors: { id: string; name: string }[] = []) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <RemarkDialog open onOpenChange={() => undefined} fiscalYearId="y25" target={{ type: 'entry', id: 'e1', label: '2025-0141 · Barausgabe Sommerfest' }} me="Klara Prüf" paperAuditors={paperAuditors} />
    </NextIntlClientProvider>,
  );

describe('RemarkDialog (Board 4d)', () => {
  it('names the target as a fixed value; the kind says its consequence; „Von“ only with a paper auditor', () => {
    open();
    expect(screen.getByRole('group', { name: /2025-0141/ })).toBeTruthy();
    expect(screen.getByText(m('finance.audit.remarkDialog.kindHint.question'))).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: m('finance.audit.remarks.kind.finding') }));
    expect(screen.getByText(m('finance.audit.remarkDialog.kindHint.finding'))).toBeTruthy();
    expect(screen.queryByLabelText(m('finance.audit.remarkDialog.from'))).toBeNull();
  });

  it('enters a remark for the paper auditor and keeps the dialog open on a refusal', async () => {
    actions.createRemarkAction.mockResolvedValue({ status: 'error', message: 'x', fieldErrors: { text: 'Bitte einen Text eingeben.' } });
    open([{ id: 'p1', name: 'Paula Papier' }]);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Unterschrift fehlt.' } });
    fireEvent.change(screen.getByLabelText(m('finance.audit.remarkDialog.from')), { target: { value: 'p1' } });
    fireEvent.click(screen.getByRole('button', { name: m('finance.audit.remarkDialog.save') }));
    await waitFor(() => expect(actions.createRemarkAction).toHaveBeenCalledWith({ fiscalYearId: 'y25', kind: 'question', targetType: 'entry', targetId: 'e1', text: 'Unterschrift fehlt.', onBehalfOfAuditorId: 'p1' }));
    expect(await screen.findByText('Bitte einen Text eingeben.')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
