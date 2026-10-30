// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

const followUpMailStateAction = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/(shell)/dms/actions', () => ({ followUpMailStateAction, createFollowUpAction: vi.fn(), completeFollowUpAction: vi.fn(), reopenFollowUpAction: vi.fn() }));
const { FollowUpsPanel } = await import('@/app/(shell)/dms/[id]/follow-ups-panel');
afterEach(cleanup);
beforeEach(() => followUpMailStateAction.mockReset());

const m = (path: string) => path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], messages) as string;
const users = [{ id: 'u-greta', name: 'Greta Sommer' }, { id: 'u-thomas', name: 'Thomas Wendt' }];
const open = () => {
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <FollowUpsPanel documentId="d1" followUps={[]} users={users} today="2026-10-28" canManage />
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: m('dms.followUps.add') }));
  const dialog = screen.getByRole('dialog');
  return { dialog, select: within(dialog).getByLabelText(m('dms.followUps.assignee')) };
};

describe('Hinweis beim Zuweisen einer Wiedervorlage (Rückmeldung Frage 2)', () => {
  it('a person without a valid address gets the hint, one with mail none', async () => {
    followUpMailStateAction.mockImplementation(async (id: string) => (id === 'u-greta' ? 'noAddress' : 'ready'));
    const { dialog, select } = open();
    fireEvent.change(select, { target: { value: 'u-greta' } });
    expect(await within(dialog).findByTestId('follow-up-mail-hint')).toBeTruthy();
    expect(within(dialog).getByTestId('follow-up-mail-hint').textContent).toContain('Greta Sommer');
    fireEvent.change(select, { target: { value: 'u-thomas' } });
    await waitFor(() => expect(within(dialog).queryByTestId('follow-up-mail-hint')).toBeNull());
  });

  it('nobody in particular asks nothing and shows nothing', async () => {
    const { dialog, select } = open();
    fireEvent.change(select, { target: { value: '' } });
    expect(followUpMailStateAction).not.toHaveBeenCalled();
    expect(within(dialog).queryByTestId('follow-up-mail-hint')).toBeNull();
  });

  it('a later choice is not overtaken by an earlier answer', async () => {
    let first: (v: string) => void = () => undefined;
    followUpMailStateAction.mockImplementationOnce(() => new Promise((r) => (first = r))).mockImplementationOnce(async () => 'ready');
    const { dialog, select } = open();
    fireEvent.change(select, { target: { value: 'u-greta' } });
    fireEvent.change(select, { target: { value: 'u-thomas' } });
    await waitFor(() => expect(followUpMailStateAction).toHaveBeenCalledTimes(2));
    await act(async () => first('noAddress'));
    expect(within(dialog).queryByTestId('follow-up-mail-hint')).toBeNull();
  });
});
