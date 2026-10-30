import { describe, expect, it, vi } from 'vitest';
import { createLiveQueue, type SendResult } from '@/lib/governance/live-queue';

/** Eine falsche Uhr: `schedule` merkt sich die Aufgaben, `tick` führt sie aus. */
function fakeSchedule() {
  const tasks: { fn: () => void; ms: number }[] = [];
  return { schedule: (fn: () => void, ms: number) => { const task = { fn, ms }; tasks.push(task); return () => tasks.splice(tasks.indexOf(task), 1); }, tasks, tick: () => tasks.splice(0).forEach((t) => t.fn()) };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
function deferred() {
  let resolve!: (r: SendResult) => void;
  const promise = new Promise<SendResult>((r) => (resolve = r));
  return { promise, resolve };
}

describe('createLiveQueue (Review Focus 1)', () => {
  it('sends in order, one at a time', async () => {
    const order: string[] = [];
    const first = deferred();
    const q = createLiveQueue({ onState: () => {}, onSaved: () => {} });
    q.enqueue({ key: 'a', send: () => { order.push('a'); return first.promise; } });
    q.enqueue({ key: 'b', send: async () => { order.push('b'); return { kind: 'ok', at: '2026-11-12T19:00:00Z' }; } });
    await flush();
    expect(order).toEqual(['a']);
    first.resolve({ kind: 'ok', at: '2026-11-12T19:00:00Z' });
    await flush();
    await flush();
    expect(order).toEqual(['a', 'b']);
  });

  it('replaces a waiting entry with the same key at its place', async () => {
    const sent: string[] = [];
    const first = deferred();
    const q = createLiveQueue({ onState: () => {}, onSaved: () => {} });
    q.enqueue({ key: 'x', send: () => { sent.push('x0'); return first.promise; } });
    q.enqueue({ key: 'c', send: async () => { sent.push('c1'); return { kind: 'ok', at: 't' }; } });
    q.enqueue({ key: 'd', send: async () => { sent.push('d'); return { kind: 'ok', at: 't' }; } });
    q.enqueue({ key: 'c', send: async () => { sent.push('c2'); return { kind: 'ok', at: 't' }; } });
    expect(q.pending()).toBe(3);
    first.resolve({ kind: 'ok', at: 't' });
    for (let i = 0; i < 6; i++) await flush();
    expect(sent).toEqual(['x0', 'c2', 'd']);
  });

  it('holds on network and retries after the delay or at once on retryNow; states saving → offline → saved', async () => {
    const clock = fakeSchedule();
    const states: string[] = [];
    let fail = true;
    const send = vi.fn(async (): Promise<SendResult> => (fail ? { kind: 'network' } : { kind: 'ok', at: '2026-11-12T20:17:00Z' }));
    const saved = vi.fn();
    const q = createLiveQueue({ onState: (s) => states.push(s.kind), onSaved: saved, retryMs: [2000], schedule: clock.schedule });
    q.enqueue({ key: 'a', send });
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(q.pending()).toBe(1);
    expect(clock.tasks.map((t) => t.ms)).toEqual([2000]);
    clock.tick();
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
    fail = false;
    q.retryNow();
    await flush();
    await flush();
    expect(send).toHaveBeenCalledTimes(3);
    expect(q.pending()).toBe(0);
    expect(saved).toHaveBeenCalledTimes(1);
    expect(states[0]).toBe('saving');
    expect(states).toContain('offline');
    expect(states.at(-1)).toBe('saved');
  });

  it('a refusal goes to onRefused and the queue goes on', async () => {
    const refused = vi.fn();
    const later = vi.fn(async (): Promise<SendResult> => ({ kind: 'ok', at: 't' }));
    const q = createLiveQueue({ onState: () => {}, onSaved: () => {} });
    q.enqueue({ key: 'a', send: async () => ({ kind: 'refused', state: { status: 'error', message: 'notWriter', fieldErrors: {} } }), onRefused: refused });
    q.enqueue({ key: 'b', send: later });
    for (let i = 0; i < 4; i++) await flush();
    expect(refused).toHaveBeenCalledWith(expect.objectContaining({ message: 'notWriter' }));
    expect(later).toHaveBeenCalled();
  });

  it('keeps unsent entries in storage and drops them once sent (Entscheidung 2)', async () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    const clock = fakeSchedule();
    const q = createLiveQueue({ onState: () => {}, onSaved: () => {}, schedule: clock.schedule, storage: { area: storage, key: 'm1' } });
    q.enqueue({ key: 'note:1', payload: { note: 'x' }, send: async () => ({ kind: 'network' }) });
    await flush();
    expect(JSON.parse(store.get('kompass.live.m1')!)).toEqual([{ key: 'note:1', payload: { note: 'x' } }]);
    q.dispose();
    const q2 = createLiveQueue({ onState: () => {}, onSaved: () => {}, storage: { area: storage, key: 'm1' } });
    expect(q2.restore()).toEqual([{ key: 'note:1', payload: { note: 'x' } }]);
    q2.enqueue({ key: 'note:1', payload: { note: 'x' }, send: async () => ({ kind: 'ok', at: 't' }) });
    for (let i = 0; i < 3; i++) await flush();
    expect(store.has('kompass.live.m1')).toBe(false);
  });
});
