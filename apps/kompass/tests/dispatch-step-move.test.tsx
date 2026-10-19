// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DispatchStep, type DispatchMailRow, type DispatchPostRow } from '@/components/dispatch-step';
import messages from '../messages/de.json';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(cleanup);

const mailRow = (id: string, name: string, state: DispatchMailRow['state'], sentAt: string | null = null): DispatchMailRow => ({ documentId: id, documentNumber: `BRF-${id}`, name, detail: null, sentAt, address: 'kim@example.org', state, outboxId: state === 'notQueued' ? null : `o-${id}`, errorText: null, errorCode: null });
const postRow = (id: string, name: string, reason: string, dispatched = false): DispatchPostRow => ({ documentId: id, documentNumber: `BRF-${id}`, name, detail: null, sentAt: dispatched ? '2026-10-18' : null, reason, dispatched });

function step(mail: DispatchMailRow[], post: DispatchPostRow[], onMove = vi.fn(async () => ({ status: 'success' as const, message: 'In die Post-Gruppe verschoben.' }))) {
  const noop = async () => ({ status: 'idle' as const });
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <DispatchStep mail={mail} post={post} done={false} mailState={{ kind: 'ready', redirectTo: null }} canSend canMark today="2026-10-19" printHref="/print" documentHref={(id) => `/dms/${id}`} onSendAll={noop} onMark={noop} onResend={noop} onMove={onMove} runRef="membersFeeRun:R1" />
    </NextIntlClientProvider>,
  );
  return onMove;
}

/** Plan U4 Task 2 (Nachtrag MCP-Test § 2): „Per Post schicken“ je Zeile über das Zeilenmenü, zurück, solange nicht vermerkt. */
describe('DispatchStep: Zeilen zwischen den Gruppen verschieben', () => {
  it('bietet „Per Post schicken“ bei wartet und nicht zugestellt, nicht bei wird gesendet und gesendet', () => {
    step([mailRow('a', 'Anna', 'notQueued'), mailRow('b', 'Bert', 'queued'), mailRow('c', 'Cora', 'failed'), mailRow('d', 'Dora', 'sending'), mailRow('e', 'Emil', 'sent', '2026-10-18')], []);
    for (const name of ['Anna', 'Bert', 'Cora']) expect(screen.getByRole('button', { name: `Aktionen für ${name}` })).toBeTruthy();
    for (const name of ['Dora', 'Emil']) expect(screen.queryByRole('button', { name: `Aktionen für ${name}` })).toBeNull();
    // Kein Knopf je Zeile.
    expect(within(screen.getByTestId('dispatch-mail')).queryByRole('button', { name: 'Per Post schicken' })).toBeNull();
  });

  it('verschiebt eine Zeile in die Post-Gruppe', async () => {
    const onMove = step([mailRow('a', 'Anna', 'notQueued')], []);
    fireEvent.click(screen.getByRole('button', { name: 'Aktionen für Anna' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Per Post schicken' }));
    await waitFor(() => expect(onMove).toHaveBeenCalledWith(['a'], 'post'));
  });

  it('„Zurück zu E-Mail“ nur bei von Hand verschobenen Zeilen ohne Vermerk; Grundtexte', async () => {
    const onMove = step([], [postRow('a', 'Anna', 'manual'), postRow('b', 'Bert', 'manual', true), postRow('c', 'Cora', 'noEmail'), postRow('d', 'Dora', 'mailOff')]);
    const post = screen.getByTestId('dispatch-post');
    expect(post.textContent).toContain('von Hand verschoben');
    expect(post.textContent).toContain('E-Mail-Versand aus');
    expect(screen.queryByRole('button', { name: 'Aktionen für Bert' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Aktionen für Cora' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Aktionen für Anna' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Zurück zu E-Mail' }));
    await waitFor(() => expect(onMove).toHaveBeenCalledWith(['a'], 'email'));
  });

  it('der Ausweg im Hinweis heißt bei mehr als einer offenen Zeile „Alle offenen per Post schicken“', async () => {
    const onMove = step([mailRow('a', 'Anna', 'failed'), mailRow('b', 'Bert', 'failed')], []);
    fireEvent.click(screen.getByRole('button', { name: 'Alle offenen per Post schicken' }));
    await waitFor(() => expect(onMove).toHaveBeenCalledWith(['a', 'b'], 'post'));
    cleanup();
    step([mailRow('a', 'Anna', 'failed')], []);
    expect(screen.getByRole('button', { name: 'Per Post schicken' })).toBeTruthy();
  });
});
