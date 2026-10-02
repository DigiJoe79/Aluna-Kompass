'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import type { ActionState } from '@/lib/actions';

const POLL_MS = 1000;

export type SiteJobKind = 'preview' | 'publish' | 'deployCheck';

/** Der letzte abgeschlossene Lauf, wie /site/job/[kind] ihn liefert. */
export interface SiteJobOutcome<T> {
  runId: string;
  startedAt: string;
  finishedAt: string;
  result?: T;
  /** Übersetzt. */
  error?: string;
}

interface SiteJobState<T> {
  running: { runId: string; startedAt: string } | null;
  last: SiteJobOutcome<T> | null;
}

const readState = <T,>(kind: SiteJobKind) =>
  fetch(`/site/job/${kind}`, { cache: 'no-store' })
    .then((r) => (r.ok ? (r.json() as Promise<SiteJobState<T>>) : null))
    .catch(() => null);

/**
 * Vorschau, Publish und Verbindungstest laufen im Hintergrund (sie bauen die
 * Seite); eine Server Action startet sie nur und nennt die Kennung des Laufs.
 * Danach fragt dieser Haken /site/job/[kind] ab, bis der letzte Lauf dieser
 * ist, und meldet ihn an `onDone`. Läuft beim Öffnen der Seite schon einer
 * derselben Art, wartet er auf diesen.
 *
 * `keepLast`: das Ergebnis des letzten Laufs auch nach dem Neuladen zeigen —
 * beim Verbindungstest ja; bei Vorschau und Publish nicht, deren Unterschiede
 * gegenüber Live wären nach einem Publish veraltet.
 */
export function useSiteJob<T>(kind: SiteJobKind, { keepLast = false, onDone }: { keepLast?: boolean; onDone?: (outcome: SiteJobOutcome<T>) => void } = {}) {
  const [last, setLast] = useState<SiteJobOutcome<T> | null>(null);
  // Der Lauf, auf dessen Ergebnis gewartet wird.
  const [waitingFor, setWaitingFor] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });

  useEffect(() => {
    void readState<T>(kind).then((state) => {
      if (!state) return;
      if (keepLast) setLast(state.last);
      if (state.running) setWaitingFor(state.running.runId);
    });
  }, [kind, keepLast]);

  useEffect(() => {
    if (!waitingFor) return;
    let active = true;
    const timer = setInterval(() => {
      void readState<T>(kind).then((state) => {
        if (!active || !state || state.running?.runId === waitingFor || state.last?.runId !== waitingFor) return;
        setLast(state.last);
        setWaitingFor(null);
        done.current?.(state.last);
      });
    }, POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [kind, waitingFor]);

  const start = (action: () => Promise<ActionState>) =>
    startTransition(async () => {
      const s = await action();
      if (s.status === 'error') toast.error(s.message);
      else if (s.status === 'success') setWaitingFor((s.data as { runId: string }).runId);
    });

  return { last, busy: pending || waitingFor !== null, start };
}
