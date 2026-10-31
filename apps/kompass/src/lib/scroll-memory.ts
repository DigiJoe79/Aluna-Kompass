'use client';

import { type RefObject, useEffect } from 'react';

const STORE = 'kompass.scroll';
export const SCROLL_LIMIT = 50;
/** Solange darf eine zurückgeholte Seite brauchen, bis sie hoch genug ist. */
const RESTORE_MS = 1500;

type ScrollTable = Record<string, number>;

export function withScroll(table: ScrollTable, key: string, top: number): ScrollTable {
  const { [key]: _old, ...rest } = table;
  return Object.fromEntries([...Object.entries(rest), [key, top] as const].slice(-SCROLL_LIMIT));
}

/** `sessionStorage` kann schon beim Zugriff werfen (privates Fenster, gesperrte Website-Daten). */
function readTable(): ScrollTable {
  try {
    return JSON.parse(sessionStorage.getItem(STORE) ?? '{}') as ScrollTable;
  } catch {
    return {};
  }
}

function writeTable(table: ScrollTable) {
  try {
    sessionStorage.setItem(STORE, JSON.stringify(table));
  } catch {
    // Dann kommt die Stelle eben nicht wieder.
  }
}

/**
 * Bringt beim Zurück- und Vorgehen die Stelle wieder. Der Browser holt nur das Scrollen des Fensters zurück, die Schale
 * scrollt aber in `<main>`. Merken pausiert, solange zurückgeholt wird: Sonst überschriebe das Scrollen der noch alten
 * oder halb geladenen Seite den gemerkten Wert (Spec Rückweg aus der Akte § 3.3).
 */
export function useScrollMemory(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof navigation === 'undefined') return;
    let table = readTable();
    let frame = 0;
    let stopRestoring: (() => void) | null = null;

    const remember = () => {
      frame = 0;
      const key = navigation.currentEntry?.key;
      if (!key || stopRestoring) return;
      table = withScroll(table, key, element.scrollTop);
      writeTable(table);
    };
    const onScroll = () => {
      if (!frame && !stopRestoring) frame = requestAnimationFrame(remember);
    };
    const restore = (top: number) => {
      stopRestoring?.();
      const started = performance.now();
      let step = 0;
      const stop = () => {
        cancelAnimationFrame(step);
        for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) element.removeEventListener(type, stop);
        stopRestoring = null;
      };
      const follow = () => {
        if (element.scrollHeight - element.clientHeight >= top && element.scrollTop !== top) element.scrollTop = top;
        if (performance.now() - started < RESTORE_MS) step = requestAnimationFrame(follow);
        else stop();
      };
      for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) element.addEventListener(type, stop, { passive: true });
      stopRestoring = stop;
      follow();
    };
    const onEntryChange = (event: NavigationCurrentEntryChangeEvent) => {
      const key = navigation.currentEntry?.key;
      if (event.navigationType === 'traverse' && key) restore(table[key] ?? 0);
    };

    element.addEventListener('scroll', onScroll, { passive: true });
    navigation.addEventListener('currententrychange', onEntryChange);
    return () => {
      cancelAnimationFrame(frame);
      stopRestoring?.();
      element.removeEventListener('scroll', onScroll);
      navigation.removeEventListener('currententrychange', onEntryChange);
    };
  }, [ref]);
}
