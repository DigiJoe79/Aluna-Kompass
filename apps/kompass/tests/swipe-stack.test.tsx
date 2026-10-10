// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() }));
const nav = vi.hoisted(() => ({ push: vi.fn() }));
const actions = vi.hoisted(() => ({ accept: vi.fn(), reject: vi.fn() }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: nav.push, refresh: vi.fn() }) }));
vi.mock('@/app/(shell)/animals/proposals/actions', () => ({ acceptProposalAction: actions.accept, rejectProposalAction: actions.reject }));
vi.mock('@/components/site/pending-publish', () => ({ PendingPublishNote: () => <p>pending</p> }));
vi.mock('@/components/site/site-job-provider', () => ({ useSiteJobStatus: () => ({ refresh }) }));

import { SwipeStack, type StackCard } from '@/app/(shell)/animals/proposals/review/swipe-stack';
import { flushHeldDecision } from '@/lib/held-decision';

function Intl({ children }: { children: ReactNode }) {
  return <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">{children}</NextIntlClientProvider>;
}
const card = (id: string, name: string, o: Partial<StackCard> = {}): StackCard => ({
  id, kind: 'update', name, sourceName: 'Tierbörse', createdAt: '2026-10-05T07:12:00.000Z', image: null, lines: [{ label: 'Größe (cm)', from: '52', to: '55' }], photosLine: null, right: { kind: 'accept', publish: false }, ...o,
});
const frame = { aspectRatio: '4 / 5', objectPosition: '50% 30%' };
const settle = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const pass = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); }); await settle(); };
const undoFromToast = () => act(() => (toastMock.mock.calls.at(-1)![1] as { action: { onClick: () => void } }).action.onClick());

beforeEach(() => {
  vi.useFakeTimers();
  toastMock.mockClear();
  nav.push.mockClear();
  refresh.mockClear();
  actions.accept.mockReset().mockResolvedValue({ status: 'success' });
  actions.reject.mockReset().mockResolvedValue({ status: 'success' });
});
afterEach(() => {
  flushHeldDecision();
  cleanup();
  vi.useRealTimers();
});

describe('SwipeStack (Board 3b–3e, 8b)', () => {
  it('accepts with the preselection after five seconds and moves on', async () => {
    render(<SwipeStack frame={frame} cards={[card('P1', 'Mira'), card('P2', 'Nala')]} backHref="/animals/proposals" query="" />, { wrapper: Intl });
    expect(screen.getByText('1 von 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Annehmen' }));
    expect(screen.getByRole('heading', { name: 'Nala' })).toBeTruthy();
    expect(screen.getByText('2 von 2')).toBeTruthy();
    expect(toastMock).toHaveBeenLastCalledWith('Mira angenommen', expect.anything());
    await pass(4_999);
    expect(actions.accept).not.toHaveBeenCalled();
    await pass(1);
    expect(actions.accept).toHaveBeenCalledWith({ id: 'P1' }, 'Mira');
  });

  it('leads to the review page for a card that needs one, without sending anything', async () => {
    render(<SwipeStack frame={frame} cards={[card('P2', 'Baxter', { right: { kind: 'review', reasons: ['conflict'] } })]} backHref="/animals/proposals" query="text=Baxter" />, { wrapper: Intl });
    expect(screen.getByText('Konflikt mit einer Änderung in Kompass. Annehmen geht hier nur über die Prüfseite.')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(nav.push).toHaveBeenCalledWith('/animals/proposals/P2?text=Baxter');
    expect(screen.getByRole('button', { name: 'Prüfen und dort annehmen' })).toBeTruthy();
    expect(actions.accept).not.toHaveBeenCalled();
  });

  it('names what a new dog lacks', () => {
    render(<SwipeStack frame={frame} cards={[card('P3', 'Bodo', { kind: 'create', right: { kind: 'review', reasons: ['missingPrimaryPhoto', 'missingSummary'] } })]} backHref="/x" query="" />, { wrapper: Intl });
    expect(screen.getByText('Kein Titelbild · Kein Kurztext. Annehmen geht hier nur über die Prüfseite.')).toBeTruthy();
  });

  it('rejects to the left without a reason', async () => {
    render(<SwipeStack frame={frame} cards={[card('P1', 'Mira')]} backHref="/x" query="" />, { wrapper: Intl });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    await pass(5_000);
    expect(actions.reject).toHaveBeenCalledWith('P1', '', 'Mira');
    expect(screen.getByText('0 angenommen · 1 abgelehnt · 0 offen gelassen')).toBeTruthy();
  });

  it('undo sends nothing and puts the card back in front', async () => {
    render(<SwipeStack frame={frame} cards={[card('P1', 'Mira'), card('P2', 'Nala')]} backHref="/x" query="" />, { wrapper: Intl });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    undoFromToast();
    await pass(10_000);
    expect(actions.accept).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Mira' })).toBeTruthy();
    expect(screen.getByText('1 von 2')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    undoFromToast();
    expect(screen.getByRole('heading', { name: 'Nala' })).toBeTruthy();
    await pass(5_000);
    flushHeldDecision();
    await settle();
    // Rückgängig nimmt auch die Zählung zurück: Mira abgelehnt, Nala wieder vorn.
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByText('0 angenommen · 2 abgelehnt · 0 offen gelassen')).toBeTruthy();
  });

  it('puts a new dog online to the right', async () => {
    render(<SwipeStack frame={frame} cards={[card('P4', 'Ronja', { kind: 'create', right: { kind: 'accept', publish: true } })]} backHref="/x" query="" />, { wrapper: Intl });
    fireEvent.click(screen.getByRole('button', { name: 'Annehmen' }));
    expect(toastMock).toHaveBeenLastCalledWith('Ronja angenommen und veröffentlicht', expect.anything());
    await pass(5_000);
    expect(actions.accept).toHaveBeenCalledWith({ id: 'P4', publish: true }, 'Ronja');
  });

  it('shows the title photo in the frame of the website, with the crop of the source when there is one', () => {
    const { container } = render(<SwipeStack frame={frame} cards={[card('P1', 'Mira', { image: { url: '/media/A1/preview', crop: null, ratio: null } })]} backHref="/x" query="" />, { wrapper: Intl });
    const img = container.querySelector<HTMLImageElement>('[data-testid="stack-card"] img')!;
    expect(img.getAttribute('src')).toBe('/media/A1/preview');
    // Wie die Webseite und die Fotokacheln des Tiers: Format und Fokus aus `animals.photoFrame`, `object-cover`.
    expect(img.getAttribute('style')).toContain('aspect-ratio: 4 / 5');
    expect(img.getAttribute('style')).toContain('object-position: 50% 30%');
    expect(screen.queryByTestId('crop-rect')).toBeNull();
    // Der Stapel hält seine Karten ab dem Öffnen (`useState`): neu öffnen statt neu rendern.
    cleanup();
    render(<SwipeStack frame={frame} cards={[card('P1', 'Mira', { image: { url: '/animals/proposal-images/I1', crop: { x: 0, y: 0.1, w: 1, h: 0.8 }, ratio: 0.75 } })]} backHref="/x" query="" />, { wrapper: Intl });
    expect(screen.getByRole('img', { name: 'Ausschnitt der Quelle' })).toBeTruthy();
    expect(screen.getByTestId('crop-rect')).toBeTruthy();
  });

  it('keeps the three buttons short and says on the card that accepting puts a new dog online', () => {
    render(<SwipeStack frame={frame} cards={[card('P4', 'Ronja', { kind: 'create', right: { kind: 'accept', publish: true } })]} backHref="/x" query="" />, { wrapper: Intl });
    expect(screen.getByRole('button', { name: 'Ablehnen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Prüfen' })).toBeTruthy();
    const accept = screen.getByRole('button', { name: 'Annehmen' });
    // Die lange Fassung steht als Zeile auf der Karte und ist die Beschreibung des Knopfs (WCAG 2.5.3: Name = sichtbarer Text).
    expect(screen.getByText('Annehmen stellt den Hund online.')).toBeTruthy();
    expect(document.getElementById(accept.getAttribute('aria-describedby')!)?.textContent).toBe('Annehmen stellt den Hund online.');
  });

  it('counts a refused decision as left open and shows why', async () => {
    actions.accept.mockResolvedValueOnce({ status: 'error', message: 'Der Vorschlag ist nicht mehr offen.', fieldErrors: {} });
    render(<SwipeStack frame={frame} cards={[card('P1', 'Mira')]} backHref="/x" query="" />, { wrapper: Intl });
    fireEvent.click(screen.getByRole('button', { name: 'Annehmen' }));
    await pass(5_000);
    expect(screen.getByText('Der Vorschlag ist nicht mehr offen.')).toBeTruthy();
    expect(screen.getByText(/Mira/, { selector: '[role="alert"] *' })).toBeTruthy();
    expect(screen.getByText('0 angenommen · 0 abgelehnt · 1 offen gelassen')).toBeTruthy();
  });

  it('ends with the tally and the note about the website; refreshes it after sending', async () => {
    render(<SwipeStack frame={frame} cards={[card('P1', 'Mira')]} backHref="/x" query="" />, { wrapper: Intl });
    fireEvent.click(screen.getByRole('button', { name: 'Annehmen' }));
    expect(screen.getByText('Alle durchgesehen')).toBeTruthy();
    expect(screen.getByText('pending')).toBeTruthy();
    // Die zurückgehaltene Entscheidung zählt sofort, nicht erst nach 5 s (M3).
    expect(screen.getByText('1 angenommen · 0 abgelehnt · 0 offen gelassen')).toBeTruthy();
    await pass(5_000);
    expect(screen.getByText('1 angenommen · 0 abgelehnt · 0 offen gelassen')).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });

  it('Fertig sends a held decision at once and goes back', async () => {
    render(<SwipeStack frame={frame} cards={[card('P1', 'Mira'), card('P2', 'Nala')]} backHref="/animals/proposals" query="" />, { wrapper: Intl });
    fireEvent.click(screen.getByRole('button', { name: 'Annehmen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fertig' }));
    expect(actions.accept).toHaveBeenCalledOnce();
    expect(nav.push).toHaveBeenCalledWith('/animals/proposals');
  });

  it('keeps the tally when the server renders the page again without the decided cards', async () => {
    const { rerender } = render(<SwipeStack frame={frame} cards={[card('P1', 'Mira')]} backHref="/x" query="" />, { wrapper: Intl });
    fireEvent.click(screen.getByRole('button', { name: 'Annehmen' }));
    await pass(5_000);
    rerender(<SwipeStack frame={frame} cards={[]} backHref="/x" query="" />);
    expect(screen.getByText('Alle durchgesehen')).toBeTruthy();
    expect(screen.getByText('1 angenommen · 0 abgelehnt · 0 offen gelassen')).toBeTruthy();
  });

  it('says so when there is nothing to go through from the start', () => {
    render(<SwipeStack frame={frame} cards={[]} backHref="/x" query="" />, { wrapper: Intl });
    expect(screen.getByText('Keine offenen Vorschläge')).toBeTruthy();
    expect(screen.queryByText('Alle durchgesehen')).toBeNull();
  });

  it('a refusal that arrives after the stack is gone still shows, as a lasting toast (Review Focus 2)', async () => {
    actions.accept.mockResolvedValueOnce({ status: 'error', message: 'Der Vorschlag ist nicht mehr offen.', fieldErrors: {} });
    const { unmount } = render(<SwipeStack frame={frame} cards={[card('P1', 'Mira'), card('P2', 'Nala')]} backHref="/x" query="" />, { wrapper: Intl });
    fireEvent.click(screen.getByRole('button', { name: 'Annehmen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fertig' }));
    unmount();
    await settle();
    expect(toastMock.error).toHaveBeenCalledWith('Der Vorschlag ist nicht mehr offen.', expect.objectContaining({ duration: Infinity }));
  });
});
