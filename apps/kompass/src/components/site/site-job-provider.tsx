'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { toast } from 'sonner';
import { nextPollDelay, transitions } from '@/lib/site-job-poll';
import type { OverviewView } from '@/lib/site-job-view';

export interface SiteJobStatus {
  /** Ohne Provider (Webseite aus oder Recht fehlt) bleibt alles leer. */
  enabled: boolean;
  running: OverviewView['running'];
  last: OverviewView['last'] | null;
  /** Nach einem Start: sofort abfragen und den Lauf als „begleitet“ merken. */
  track(runId: string): void;
  refresh(): void;
}

const OFF: SiteJobStatus = { enabled: false, running: null, last: null, track: () => {}, refresh: () => {} };

/**
 * Der Abfragestand lebt in einem Store, nicht im Context-Wert: Der Context
 * hält nur den Store und ändert sich nie. Ein wechselnder Context-Wert oberhalb
 * der ganzen Seite erreicht auch Suspense-Grenzen, die noch nicht hydriert
 * sind, und React rendert sie dann im Client neu — im Image blieb so der
 * gestreamte Server-Teil (`<div hidden id="S:0">`) als zweite Kopie der Seite
 * im DOM stehen (0.2.5, Image-Ring). Über `useSyncExternalStore` erneuern sich
 * nur die Verbraucher.
 */
interface SiteJobStore {
  subscribe(listener: () => void): () => void;
  get(): OverviewView | null;
  track(runId: string): void;
  refresh(): void;
}
export const SiteJobStoreContext = createContext<SiteJobStore | null>(null);
/** Für Tests: ein fester Stand ohne Poller. */
export const SiteJobContext = createContext<SiteJobStatus | null>(null);
const NO_STORE: SiteJobStore = { subscribe: () => () => {}, get: () => null, track: () => {}, refresh: () => {} };
const serverSnapshot = () => null;

export function useSiteJobStatus(): SiteJobStatus {
  const fixed = useContext(SiteJobContext);
  const store = useContext(SiteJobStoreContext);
  const source = store ?? NO_STORE;
  const state = useSyncExternalStore(source.subscribe, source.get, serverSnapshot);
  return useMemo(
    () => fixed ?? (store ? { enabled: true, running: state?.running ?? null, last: state?.last ?? null, track: store.track, refresh: store.refresh } : OFF),
    [fixed, store, state],
  );
}

/** Seiten, deren Server-Teil sich bei Start und Ende eines Laufs erneuern soll (Kachel, Publish-Seite). */
const REFRESH_ON = (pathname: string) => pathname === '/' || pathname.startsWith('/site/publish');

/**
 * Der einzige Poller je Tab. Kopfzeile, Laufkarte und Karten der Publish-Seite
 * lesen denselben Stand, damit nicht jede Komponente selbst fragt. Gefragt wird
 * nur über einen Route Handler (Server Actions einer Seite laufen seriell), und
 * nur, solange der Tab sichtbar ist.
 */
export function SiteJobProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations('site.publish.job');
  const seen = useRef(new Set<string>());
  const pollNow = useRef<() => void>(() => {});
  const [store] = useState<SiteJobStore & { set(next: OverviewView): void }>(() => {
    let current: OverviewView | null = null;
    const listeners = new Set<() => void>();
    return {
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      get: () => current,
      set: (next) => {
        current = next;
        for (const listener of listeners) listener();
      },
      track: (runId) => {
        seen.current.add(runId);
        pollNow.current();
      },
      refresh: () => pollNow.current(),
    };
  });
  // Die Abfrageschleife läuft ein Mal je Tab; was sich ändert, liest sie über Refs.
  const latest = useRef({ pathname, router, t });
  useEffect(() => {
    latest.current = { pathname, router, t };
  });

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let prev: OverviewView | null = null;
    const poll = async () => {
      clearTimeout(timer);
      if (document.visibilityState === 'hidden') return; // pausiert; visibilitychange holt nach
      const next = await fetch('/site/job', { cache: 'no-store' })
        .then((r) => (r.ok ? (r.json() as Promise<OverviewView>) : null))
        .catch(() => null);
      if (!active) return;
      if (next) {
        if (next.running) seen.current.add(next.running.runId);
        const { started, finished } = transitions(prev, next, seen.current);
        const { pathname: here, router: nav, t: tr } = latest.current;
        for (const f of finished) {
          const kind = tr(`names.${f.kind}`);
          const openLog = { label: tr('openLog'), onClick: () => nav.push(f.kind === 'deployCheck' ? '/admin/site?panel=connection' : '/site/publish') };
          // Ein Verbindungstest endet als Lauf erfolgreich, auch wenn ein Prüfpunkt durchfiel; das Urteil steht in `passed`.
          if (f.kind === 'deployCheck' && f.summary.status === 'success' && f.summary.passed === false) toast.error(tr('done.deployCheckFailed'), { action: openLog });
          else if (f.summary.status === 'success') toast.success(tr(`done.${f.kind}`), { action: openLog });
          else toast.error(tr(`failed.${f.summary.status}`, { kind, message: f.summary.error?.message ?? '' }), { action: openLog });
        }
        if ((started || finished.length > 0) && REFRESH_ON(here)) nav.refresh();
        prev = next;
        store.set(next);
      }
      timer = setTimeout(() => void poll(), nextPollDelay(next ?? prev));
    };
    pollNow.current = () => void poll();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', onVisible);
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [store]);

  return <SiteJobStoreContext.Provider value={store}>{children}</SiteJobStoreContext.Provider>;
}
