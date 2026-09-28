'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createAutosave, type Autosave, type SaveOutcome, type SaveState } from '@/lib/autosave';

export type { SaveOutcome, SaveState } from '@/lib/autosave';

/**
 * Laufend sichern wie D1 (HANDOFF § 13.4, Design-Nachtrag Phase 4): Jede
 * Eingabe wird nach 800 ms Ruhe gesichert, beim Verlassen der Seite
 * (`visibilitychange`) sofort, nach einem Funkloch (`online`) erneut. Der
 * Stand liegt am Server; die Sicherungen laufen nacheinander, jede mit der
 * Version der vorigen (`expectedVersion` gehört in `save`). `ref` liest den
 * jüngsten Stand ohne Umweg über den Renderzyklus.
 */
export function useAutosave<T>({ initial, initialState, save }: { initial: T; initialState?: SaveState; save: (current: T) => Promise<SaveOutcome<T>> }) {
  const [value, setValue] = useState<T>(initial);
  const [state, setState] = useState<SaveState>(initialState ?? { kind: 'idle' });
  const [pending, setPending] = useState(false);
  const saveRef = useRef(save);
  saveRef.current = save;
  const ref = useRef<Autosave<T> | null>(null);
  if (ref.current === null) {
    ref.current = createAutosave<T>({
      initial,
      ...(initialState ? { initialState } : {}),
      save: (current) => saveRef.current(current),
      onValue: setValue,
      onState: (next, isPending) => {
        setState(next);
        setPending(isPending);
      },
    });
  }
  const auto = ref.current;

  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden' && auto.isDirty()) void auto.flush();
    };
    const onOnline = () => {
      if (auto.isDirty()) void auto.flush();
    };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('online', onOnline);
    };
  }, [auto]);

  useEffect(() => () => auto.dispose(), [auto]);

  const update = useCallback((fn: (current: T) => T) => auto.update(fn), [auto]);
  const set = useCallback((next: T) => auto.set(next), [auto]);
  const flush = useCallback(() => auto.flush(), [auto]);
  const markDirty = useCallback(() => auto.markDirty(), [auto]);
  const get = useCallback(() => auto.get(), [auto]);

  return { value, state, pending, update, set, flush, markDirty, get, setState };
}
