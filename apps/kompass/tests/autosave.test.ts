import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTOSAVE_MS, createAutosave, type SaveState } from '@/lib/autosave';

interface Draft {
  id: string | null;
  text: string;
  version: string | null;
}

function setup(save: (d: Draft) => Promise<{ kind: 'saved'; at: string; apply: (c: Draft) => Draft } | { kind: 'failed'; detail: string }>) {
  const states: { state: SaveState; pending: boolean }[] = [];
  const values: Draft[] = [];
  const auto = createAutosave<Draft>({
    initial: { id: null, text: '', version: null },
    save,
    onValue: (v) => values.push(v),
    onState: (state, pending) => states.push({ state, pending }),
  });
  return { auto, states, values };
}

describe('createAutosave (Design-Nachtrag Phase 4, Task 0 — gemeinsamer Autosave aus D1)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('saves once after 800 ms of quiet, with the latest state only', async () => {
    const save = vi.fn(async (d: Draft) => ({ kind: 'saved' as const, at: '2026-09-28T10:00:00Z', apply: (c: Draft) => ({ ...c, id: 'x', version: 'v1' }) }));
    const { auto, states } = setup(save);
    auto.update((d) => ({ ...d, text: 'a' }));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS - 1);
    auto.update((d) => ({ ...d, text: 'ab' }));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS - 1);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0].text).toBe('ab');
    expect(auto.get()).toMatchObject({ id: 'x', version: 'v1', text: 'ab' });
    expect(states.at(-1)).toEqual({ state: { kind: 'saved', at: '2026-09-28T10:00:00Z' }, pending: false });
    expect(AUTOSAVE_MS).toBe(800);
  });

  it('runs saves one after another, each with the version of the previous (expectedVersion)', async () => {
    let resolveFirst: (() => void) | null = null;
    const seen: (string | null)[] = [];
    let n = 0;
    const save = vi.fn(async (d: Draft) => {
      seen.push(d.version);
      n += 1;
      const version = `v${n}`;
      if (n === 1) await new Promise<void>((r) => (resolveFirst = r));
      return { kind: 'saved' as const, at: 'now', apply: (c: Draft) => ({ ...c, version }) };
    });
    const { auto } = setup(save);
    auto.update((d) => ({ ...d, text: 'a' }));
    const first = auto.flush();
    await vi.advanceTimersByTimeAsync(0);
    auto.update((d) => ({ ...d, text: 'ab' }));
    const second = auto.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);
    resolveFirst!();
    await first;
    await second;
    expect(seen).toEqual([null, 'v1']);
    expect(auto.get().text).toBe('ab');
  });

  it('keeps edits made during a save and saves them afterwards', async () => {
    let release: (() => void) | null = null;
    const save = vi.fn(async (d: Draft) => {
      if (!release) await new Promise<void>((r) => (release = r));
      return { kind: 'saved' as const, at: 'now', apply: (c: Draft) => ({ ...c, version: 'v' }) };
    });
    const { auto } = setup(save);
    auto.update((d) => ({ ...d, text: 'a' }));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
    auto.update((d) => ({ ...d, text: 'ab' }));
    release!();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS * 2);
    expect(save).toHaveBeenCalledTimes(2);
    expect(auto.get().text).toBe('ab');
  });

  it('reports offline when the save throws, and failed with the detail when the server refuses — and stays dirty', async () => {
    const save = vi.fn().mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce({ kind: 'failed', detail: 'Konflikt' });
    const { auto, states } = setup(save);
    auto.update((d) => ({ ...d, text: 'a' }));
    expect(await auto.flush()).toBeNull();
    expect(states.at(-1)!.state).toEqual({ kind: 'offline' });
    expect(await auto.flush()).toBeNull();
    expect(states.at(-1)!.state).toEqual({ kind: 'failed', detail: 'Konflikt' });
    expect(auto.isDirty()).toBe(true);
  });

  it('flush without changes returns the current value and does not call save; markDirty forces one', async () => {
    const save = vi.fn(async (d: Draft) => ({ kind: 'saved' as const, at: 'now', apply: (c: Draft) => ({ ...c, id: 'x' }) }));
    const { auto } = setup(save);
    expect(await auto.flush()).toEqual({ id: null, text: '', version: null });
    expect(save).not.toHaveBeenCalled();
    auto.markDirty();
    expect((await auto.flush())?.id).toBe('x');
  });

  it('set replaces the value without scheduling a save', async () => {
    const save = vi.fn();
    const { auto, values } = setup(save);
    auto.set({ id: 'y', text: 'z', version: 'v9' });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS * 2);
    expect(save).not.toHaveBeenCalled();
    expect(values.at(-1)).toEqual({ id: 'y', text: 'z', version: 'v9' });
  });

  it('dispose cancels a pending timer', async () => {
    const save = vi.fn();
    const { auto } = setup(save);
    auto.update((d) => ({ ...d, text: 'a' }));
    auto.dispose();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS * 2);
    expect(save).not.toHaveBeenCalled();
    // React (Strict Mode) räumt zwischendurch auf und hängt wieder ein: danach wird weiter gesichert.
    save.mockResolvedValue({ kind: 'saved', at: 'now', apply: (c: Draft) => c });
    auto.update((d) => ({ ...d, text: 'ab' }));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
