import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

import { flushHeldDecision, heldKey, holdDecision, subscribeHeld, type HeldDecision } from '@/lib/held-decision';
import type { ActionState } from '@/lib/actions';

const ok: ActionState = { status: 'success' };
const refused: ActionState = { status: 'error', message: 'Der Vorschlag ist nicht mehr offen.', fieldErrors: {} };
const decision = (key: string, send: () => Promise<ActionState>, extra: Partial<HeldDecision> = {}): HeldDecision => ({
  key,
  message: `${key} angenommen`,
  countdown: (s) => `Rückgängig · ${s}`,
  send,
  ...extra,
});
/** Der „Rückgängig“-Knopf des zuletzt gezeigten Toasts. */
const undoFromToast = () => (toastMock.mock.calls.at(-1)![1] as { action: { onClick: () => void } }).action.onClick();
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('holdDecision (Ausnahme MUSTER § C: Rückgängig heißt nicht abschicken)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    toastMock.mockClear();
  });
  afterEach(() => {
    flushHeldDecision();
    vi.useRealTimers();
  });

  it('sends after five seconds, not before, and counts down in the toast', () => {
    const send = vi.fn(async () => ok);
    holdDecision(decision('P1', send));
    expect(heldKey()).toBe('P1');
    expect((toastMock.mock.calls.at(-1)![1] as { action: { label: string } }).action.label).toBe('Rückgängig · 5');
    vi.advanceTimersByTime(1_000);
    expect((toastMock.mock.calls.at(-1)![1] as { action: { label: string } }).action.label).toBe('Rückgängig · 4');
    vi.advanceTimersByTime(3_999);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledOnce();
    expect(heldKey()).toBeNull();
  });

  it('undo means never sending', () => {
    const send = vi.fn(async () => ok);
    const onUndo = vi.fn();
    holdDecision(decision('P1', send, { onUndo }));
    undoFromToast();
    vi.advanceTimersByTime(10_000);
    expect(send).not.toHaveBeenCalled();
    expect(onUndo).toHaveBeenCalledOnce();
  });

  it('a second hold sends the first at once and holds only the second', () => {
    const a = vi.fn(async () => ok);
    const b = vi.fn(async () => ok);
    holdDecision(decision('P1', a));
    holdDecision(decision('P2', b));
    expect(a).toHaveBeenCalledOnce();
    expect(b).not.toHaveBeenCalled();
    undoFromToast();
    vi.advanceTimersByTime(10_000);
    expect(b).not.toHaveBeenCalled();
  });

  it('hands the outcome to onSent and, without it, a refusal to a lasting toast', async () => {
    const onSent = vi.fn();
    holdDecision(decision('P1', async () => refused, { onSent }));
    flushHeldDecision();
    await settle();
    expect(onSent).toHaveBeenCalledWith(refused);
    holdDecision(decision('P2', async () => refused));
    flushHeldDecision();
    await settle();
    expect(toastMock.error).toHaveBeenCalledWith('Der Vorschlag ist nicht mehr offen.', expect.objectContaining({ duration: Infinity }));
  });

  it('survives an unmount: the store lives on globalThis, not in a module or component', async () => {
    const send = vi.fn(async () => ok);
    holdDecision(decision('P1', send));
    vi.resetModules();
    const again = await import('@/lib/held-decision');
    expect(again.heldKey()).toBe('P1');
    again.flushHeldDecision();
    expect(send).toHaveBeenCalledOnce();
  });

  it('a send that throws (network) still reaches onSent as a network error, never silently', async () => {
    const onSent = vi.fn();
    holdDecision(decision('P1', async () => { throw new Error('offline'); }, { onSent, networkMessage: 'Keine Verbindung.' }));
    flushHeldDecision();
    await settle();
    expect(onSent).toHaveBeenCalledWith(expect.objectContaining({ status: 'error', kind: 'network', message: 'Keine Verbindung.' }));
  });

  it('tells subscribers when a decision is held, sent or undone — the list hides the held one (M4)', () => {
    const seen: (string | null)[] = [];
    const stop = subscribeHeld(() => seen.push(heldKey()));
    holdDecision(decision('P1', vi.fn(async () => ok)));
    undoFromToast();
    holdDecision(decision('P2', vi.fn(async () => ok)));
    vi.advanceTimersByTime(5_000);
    stop();
    holdDecision(decision('P3', vi.fn(async () => ok)));
    expect(seen).toEqual(['P1', null, 'P2', null]);
  });
});
