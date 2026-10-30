'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActionState } from '@/lib/actions';
import type { SaveState } from '@/lib/autosave';
import { runAction } from '@/lib/feedback';
import { createLiveQueue, type LiveQueue, type SendResult, type StoredOp } from './live-queue';
import { liveClock } from './clock';

/** Der Speicher des Browsers, wenn es ihn gibt (privates Fenster, gesperrte Website-Daten: ohne). */
function browserStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export interface LiveSend {
  key: string;
  /** Die Server Action; eine geworfene Ausnahme gilt als „keine Verbindung“. */
  action: () => Promise<ActionState>;
  onRefused?: (state: ActionState) => void;
  onDone?: (state: ActionState) => void;
  payload?: unknown;
}

/**
 * Die Warteschlange als Hook (Plan U1 Task 7): `online` sendet sofort nach, beim Verlassen fragt der Browser nach,
 * solange etwas aussteht; Unversandtes liegt je Sitzung im Speicher des Browsers (Entscheidung 2). `onSaved` lädt den
 * Stand des Servers (die Seite ruft `router.refresh()`).
 */
export function useLiveQueue(meetingId: string, onSaved: () => void): { enqueue: (send: LiveSend) => void; state: SaveState; pending: number; restored: StoredOp[] } {
  const t = useTranslations('common');
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const [pending, setPending] = useState(0);
  const [restored, setRestored] = useState<StoredOp[]>([]);
  const queue = useRef<LiveQueue | null>(null);
  const saved = useRef(onSaved);
  saved.current = onSaved;
  const network = t('network');

  useEffect(() => {
    const storage = browserStorage();
    const q = createLiveQueue({
      onState: (next, count) => {
        setState(next);
        setPending(count);
      },
      onSaved: () => saved.current(),
      ...(storage ? { storage: { area: storage, key: meetingId } } : {}),
    });
    queue.current = q;
    setRestored(q.restore());
    const online = () => q.retryNow();
    const leave = (event: BeforeUnloadEvent) => {
      if (q.pending() > 0) event.preventDefault();
    };
    window.addEventListener('online', online);
    window.addEventListener('beforeunload', leave);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('beforeunload', leave);
      q.dispose();
      queue.current = null;
    };
  }, [meetingId]);

  const enqueue = useCallback(
    (send: LiveSend) => {
      queue.current?.enqueue({
        key: send.key,
        payload: send.payload,
        onRefused: send.onRefused,
        send: async (): Promise<SendResult> => {
          const result = await runAction(send.action, network);
          if (result.status === 'error' && result.kind === 'network') return { kind: 'network' };
          send.onDone?.(result);
          if (result.status === 'error') return { kind: 'refused', state: result };
          return { kind: 'ok', at: liveClock.nowIso() };
        },
      });
      setPending(queue.current?.pending() ?? 0);
    },
    [network],
  );

  return { enqueue, state, pending, restored };
}
