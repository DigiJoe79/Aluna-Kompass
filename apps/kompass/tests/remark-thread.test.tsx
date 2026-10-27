// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { RemarkThread, type RemarkThreadItem } from '@/components/remark-thread';

afterEach(cleanup);

const m = (path: string) => path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], messages) as string;
const item = (id: string, state: RemarkThreadItem['state'], over: Partial<RemarkThreadItem> = {}): RemarkThreadItem => ({
  id, kindLabel: 'Frage', state, stateLabel: state, text: `Text ${id}`, byline: 'Klara Prüf · 05.02.2026', posts: [], ...over,
});
const wrap = (props: Partial<React.ComponentProps<typeof RemarkThread>> & { remarks: RemarkThreadItem[] }) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <RemarkThread canAnswer={false} canAudit={false} onAnswer={vi.fn()} onFollowUp={vi.fn()} onResolve={vi.fn()} {...props} />
    </NextIntlClientProvider>,
  );

describe('RemarkThread (N3)', () => {
  it('shows each remark with its posts; resolved ones quiet and folded away', () => {
    wrap({ remarks: [item('1', 'answered', { posts: [{ id: 'p', byline: 'Anna Kasse · 06.02.2026', text: 'Quittung nachgereicht.' }] }), item('2', 'resolved'), item('3', 'resolved')] });
    const first = screen.getByTestId('remark-1');
    expect(within(first).getByText('Text 1')).toBeTruthy();
    expect(within(first).getByText('Quittung nachgereicht.')).toBeTruthy();
    expect(within(first).getByText('answered')).toBeTruthy();
    // Zugeklappt: im Dokument, aber im geschlossenen `details` unter „2 geklärte Vermerke“.
    const folded = screen.getByText('Text 2').closest('details')!;
    expect(folded.open).toBe(false);
    expect(folded.querySelector('summary')!.textContent).toContain('2 geklärte Vermerke');
    expect(within(screen.getByTestId('remark-2')).queryByText('resolved')).toBeNull();
  });

  it('the treasurer answers inline; a refusal stays at the remark', async () => {
    const onAnswer = vi.fn(async () => ({ status: 'error' as const, message: 'Der Vermerk ist schon als geklärt markiert.', fieldErrors: {} }));
    wrap({ remarks: [item('1', 'open')], canAnswer: true, onAnswer });
    expect(screen.queryByRole('button', { name: m('common.remarkThread.resolve') })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: m('common.remarkThread.answer') }));
    fireEvent.change(screen.getByRole('textbox', { name: m('common.remarkThread.answerLabel') }), { target: { value: 'Getränke fürs Fest.' } });
    fireEvent.click(screen.getByRole('button', { name: m('common.remarkThread.answer') }));
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith('1', 'Getränke fürs Fest.'));
    expect(await screen.findByText('Der Vermerk ist schon als geklärt markiert.')).toBeTruthy();
  });

  it('the auditor asks again or marks it resolved; no „Antworten“', async () => {
    const onResolve = vi.fn(async () => ({ status: 'success' as const }));
    wrap({ remarks: [item('1', 'answered')], canAudit: true, onResolve });
    expect(screen.queryByRole('button', { name: m('common.remarkThread.answer') })).toBeNull();
    expect(screen.getByRole('button', { name: m('common.remarkThread.followUp') })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: m('common.remarkThread.resolve') }));
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith('1'));
  });
});
