import type { ActionState } from '@/lib/actions';
import type { SaveState } from '@/lib/autosave';

export type SendResult = { kind: 'ok'; at: string } | { kind: 'refused'; state: ActionState } | { kind: 'network' };

export interface LiveOp {
  /** Gleicher Schlüssel ersetzt einen noch nicht gestarteten Eintrag an seinem Platz (Zählung, Notiz eines Punkts). */
  key: string;
  send: () => Promise<SendResult>;
  onRefused?: (state: ActionState) => void;
  /** Was die Seite nach einem Neuladen wieder einreihen kann (Entscheidung 2); ohne `payload` nur im Speicher. */
  payload?: unknown;
}

export type StoredOp = { key: string; payload: unknown };
type StorageArea = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const PREFIX = 'kompass.live.';
const DEFAULT_RETRY = [2000, 5000, 10000, 30000] as const;

/**
 * Die Warteschlange des Mitlaufs (Plan U1 Task 7, Review Focus 1): der Reihe nach, eine Sendung zur Zeit. Ohne Netz
 * bleibt der Eintrag vorn und wird nach einer wachsenden Frist (oder bei `retryNow`, etwa auf `online`) erneut gesendet;
 * eine Ablehnung des Dienstes geht an `onRefused`, die Schlange läuft weiter. Unversandte Einträge mit `payload` liegen
 * zusätzlich im Speicher des Browsers je Sitzung (Entscheidung 2), bis sie gesendet sind — gelesen und geschrieben in
 * `try/catch`, weil ein privates Fenster oder ein voller Speicher werfen darf.
 */
export function createLiveQueue(opts: {
  onState: (state: SaveState, pending: number) => void;
  onSaved: () => void;
  retryMs?: readonly number[];
  schedule?: (fn: () => void, ms: number) => () => void;
  storage?: { area: StorageArea; key: string };
}) {
  const retryMs = opts.retryMs ?? DEFAULT_RETRY;
  const schedule = opts.schedule ?? ((fn, ms) => { const timer = setTimeout(fn, ms); return () => clearTimeout(timer); });
  const queue: { op: LiveOp; started: boolean }[] = [];
  let running = false;
  let attempt = 0;
  let cancelRetry: (() => void) | null = null;
  let disposed = false;
  const storageKey = opts.storage ? PREFIX + opts.storage.key : null;

  const persist = () => {
    if (!opts.storage || !storageKey) return;
    const stored: StoredOp[] = queue.filter((e) => e.op.payload !== undefined).map((e) => ({ key: e.op.key, payload: e.op.payload }));
    try {
      if (stored.length === 0) opts.storage.area.removeItem(storageKey);
      else opts.storage.area.setItem(storageKey, JSON.stringify(stored));
    } catch {
      // Ohne Speicher bleibt der Puffer im Speicher der Seite; die Rückfrage beim Verlassen schützt weiter.
    }
  };

  const pump = async () => {
    if (running || disposed || cancelRetry || queue.length === 0) return;
    running = true;
    const entry = queue[0]!;
    entry.started = true;
    opts.onState({ kind: 'saving' }, queue.length);
    let result: SendResult;
    try {
      result = await entry.op.send();
    } catch {
      result = { kind: 'network' };
    }
    running = false;
    if (disposed) return;
    if (result.kind === 'network') {
      entry.started = false;
      opts.onState({ kind: 'offline' }, queue.length);
      const wait = retryMs[Math.min(attempt, retryMs.length - 1)]!;
      attempt += 1;
      cancelRetry = schedule(() => {
        cancelRetry = null;
        void pump();
      }, wait);
      return;
    }
    attempt = 0;
    queue.shift();
    persist();
    if (result.kind === 'refused') entry.op.onRefused?.(result.state);
    if (queue.length === 0) {
      if (result.kind === 'ok') opts.onState({ kind: 'saved', at: result.at }, 0);
      else opts.onState({ kind: 'idle' }, 0);
      opts.onSaved();
      return;
    }
    void pump();
  };

  return {
    enqueue(op: LiveOp): void {
      const waiting = queue.findIndex((e) => !e.started && e.op.key === op.key);
      if (waiting >= 0) queue[waiting] = { op, started: false };
      else queue.push({ op, started: false });
      persist();
      void pump();
    },
    retryNow(): void {
      if (cancelRetry) {
        cancelRetry();
        cancelRetry = null;
      }
      void pump();
    },
    pending: (): number => queue.length,
    /** Was ein früherer Besuch nicht mehr senden konnte (Entscheidung 2); die Seite reiht es neu ein. */
    restore(): StoredOp[] {
      if (!opts.storage || !storageKey) return [];
      try {
        const raw = opts.storage.area.getItem(storageKey);
        return raw ? (JSON.parse(raw) as StoredOp[]) : [];
      } catch {
        return [];
      }
    },
    dispose(): void {
      disposed = true;
      cancelRetry?.();
      cancelRetry = null;
    },
  };
}

export type LiveQueue = ReturnType<typeof createLiveQueue>;
