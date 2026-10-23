'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { BackupJobView, BackupRunView } from '@/lib/backup-job-view';
import { POLL_IDLE_MS, POLL_RUNNING_MS } from '@/lib/site-job-poll';

export type BackupDialog = { kind: 'upload' } | { kind: 'restore' | 'pin' | 'rename' | 'unpin' | 'delete'; name: string; returnFocus: HTMLElement | null } | null;

type Snapshot = { view: BackupJobView; dialog: BackupDialog };

interface BackupStore {
  subscribe(listener: () => void): () => void;
  get(): Snapshot;
  track(runId: string): void;
  refresh(): void;
  open(dialog: Exclude<BackupDialog, null>): void;
  close(): void;
}

const StoreContext = createContext<BackupStore | null>(null);

function useStore(): BackupStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('BackupPageProvider fehlt');
  return store;
}

function useSnapshot(): Snapshot {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export function useBackupJob(): { running: BackupRunView | null; last: BackupJobView['last']; track(runId: string): void; refresh(): void } {
  const store = useStore();
  const { view } = useSnapshot();
  return useMemo(() => ({ running: view.running, last: view.last, track: store.track, refresh: store.refresh }), [view, store]);
}

export function useBackupDialog(): { dialog: BackupDialog; open(d: Exclude<BackupDialog, null>): void; close(): void } {
  const store = useStore();
  const { dialog } = useSnapshot();
  return useMemo(() => ({ dialog, open: store.open, close: store.close }), [dialog, store]);
}

/** Läufe, die zwischen zwei Abfragen endeten und die dieser Tab laufen sah (nachgebaut aus `site-job-poll.ts`). */
function finishedRuns(prev: BackupJobView | null, next: BackupJobView, seen: ReadonlySet<string>) {
  return (Object.keys(next.last) as (keyof BackupJobView['last'])[]).flatMap((kind) => {
    const now = next.last[kind];
    return now && seen.has(now.runId) && prev?.last[kind]?.runId !== now.runId ? [now] : [];
  });
}

/**
 * Abfragestand und offener Dialog der Backup-Seite in **einem** Store; der Context-Wert ändert sich nie (wie
 * `SiteJobProvider`, Erinnerung „Context über der Shell stabil halten“). Eine Abfrageschleife je Tab, nur bei
 * sichtbarem Tab, über den Route Handler `/admin/backup/job` — nie per Server Action. Endet ein Lauf, den dieser Tab
 * laufen sah, erneuert sich die Seite (die Liste kommt vom Server); antwortet die Abfrage mit Wartung, lädt die Seite
 * neu und landet auf der Wartungsseite.
 */
export function BackupPageProvider({ initial, children }: { initial: BackupJobView; children: ReactNode }) {
  const router = useRouter();
  const t = useTranslations('backup.run');
  const seen = useRef(new Set<string>(initial.running ? [initial.running.runId] : []));
  const pollNow = useRef<() => void>(() => {});
  const [store] = useState<BackupStore & { setView(view: BackupJobView): void }>(() => {
    let current: Snapshot = { view: initial, dialog: null };
    const listeners = new Set<() => void>();
    const set = (next: Snapshot) => {
      current = next;
      for (const listener of listeners) listener();
    };
    return {
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      get: () => current,
      setView: (view) => set({ ...current, view }),
      track: (runId) => {
        seen.current.add(runId);
        pollNow.current();
      },
      refresh: () => pollNow.current(),
      open: (dialog) => set({ ...current, dialog: dialog.kind === 'upload' ? dialog : { ...dialog, returnFocus: dialog.returnFocus ?? (document.activeElement as HTMLElement | null) } }),
      close: () => set({ ...current, dialog: null }),
    };
  });
  const latest = useRef({ router, t });
  useEffect(() => {
    latest.current = { router, t };
  });

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let prev: BackupJobView | null = store.get().view;
    const poll = async () => {
      clearTimeout(timer);
      if (document.visibilityState === 'hidden') return;
      const res = await fetch('/admin/backup/job', { cache: 'no-store' }).catch(() => null);
      if (!active) return;
      if (res?.status === 503) {
        // Ein Einspielen läuft: Der Proxy zeigt allen die Wartungsseite.
        window.location.reload();
        return;
      }
      const next = res?.ok ? ((await res.json().catch(() => null)) as BackupJobView | null) : null;
      if (!active) return;
      if (next) {
        if (next.running) seen.current.add(next.running.runId);
        const finished = finishedRuns(prev, next, seen.current);
        const { router: nav, t: tr } = latest.current;
        for (const f of finished) if (f.status === 'success' && f.kind !== 'restore') toast.success(tr(`done.${f.kind}`));
        if (finished.length > 0) nav.refresh();
        prev = next;
        store.setView(next);
      }
      timer = setTimeout(() => void poll(), (next ?? prev)?.running ? POLL_RUNNING_MS : POLL_IDLE_MS);
    };
    pollNow.current = () => void poll();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', onVisible);
    // Mit einem laufenden Lauf gleich weiterfragen, sonst erst nach der Ruhepause (der Server gab den Stand mit).
    timer = setTimeout(() => void poll(), initial.running ? POLL_RUNNING_MS : POLL_IDLE_MS);
    return () => {
      active = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // Die Schleife läuft einmal je Tab; `initial` ist nur der Startwert.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}
