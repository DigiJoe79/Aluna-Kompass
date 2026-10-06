'use client';

import { useState } from 'react';

/** Der Schlüssel einer Liste: ihre Filter ohne Sortierung — Sortieren zeigt dieselben Zeilen. */
export function listKeyOf(params: URLSearchParams): string {
  return [...params.entries()].filter(([key]) => key !== 'sort' && key !== 'dir').map(([key, value]) => `${key}=${value}`).sort().join('&');
}

/**
 * Die Mehrfachauswahl einer Liste, aus `dms/document-list.tsx` herausgezogen
 * (Spec 2026-10-05, § 9.1). Ein anderer Schlüssel ist eine neue Liste und
 * fängt leer an. Kommt dieselbe Liste neu vom Server, fällt heraus, was
 * nicht mehr darin steht; der Rest bleibt angekreuzt.
 */
export function useListSelection<T extends { id: string }>(listKey: string, items: readonly T[]) {
  const [state, setState] = useState({ listKey, items, ids: new Set<string>() as ReadonlySet<string> });
  let current = state;
  if (state.listKey !== listKey || state.items !== items) {
    const present = new Set(items.map((item) => item.id));
    current = { listKey, items, ids: state.listKey !== listKey ? new Set<string>() : new Set([...state.ids].filter((id) => present.has(id))) };
    setState(current);
  }
  const toggle = (ids: readonly string[], on: boolean) =>
    setState((prev) => {
      const next = new Set(prev.ids);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return { ...prev, ids: next };
    });
  return { ids: current.ids, toggle };
}
