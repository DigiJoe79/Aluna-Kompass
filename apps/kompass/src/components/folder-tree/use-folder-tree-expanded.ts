'use client';

import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { renamePrefixPaths, resolveExpanded } from '@/lib/folder-tree-model';

export type FolderTreeStorageKey = 'dmsTreeExpanded' | 'mediaTreeExpanded';

/**
 * Der gemerkte Aufklappzustand je Schlüssel, geteilt von allen Bäumen und
 * Aufrufern im Fenster: Arbeitsfläche, Dialog und Rückgängig sehen denselben
 * Stand. Je Hook-Instanz gehalten, überschrieb der Baum beim nächsten
 * Aufklappen, was eine andere Instanz nach einem Verschieben geschrieben hatte.
 */
type Entry = { raw: string | null; value: string[] };
const entries = new Map<FolderTreeStorageKey, Entry>();
/** Ohne beschreibbaren Speicher (privater Modus): der Stand nur für diese Sitzung. */
const memory = new Map<FolderTreeStorageKey, string[]>();
const listeners = new Map<FolderTreeStorageKey, Set<() => void>>();
const EMPTY: string[] = [];

const storageName = (key: FolderTreeStorageKey) => `kompass.${key}`;

function parse(raw: string | null): string[] {
  if (raw === null) return EMPTY;
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((path): path is string => typeof path === 'string') : EMPTY;
  } catch {
    return EMPTY;
  }
}

/** Stabile Referenz, solange sich der gespeicherte Text nicht ändert (`useSyncExternalStore` verlangt das). */
function readExpanded(key: FolderTreeStorageKey): string[] {
  const kept = memory.get(key);
  if (kept) return kept;
  let raw: string | null;
  try {
    raw = localStorage.getItem(storageName(key));
  } catch {
    return EMPTY;
  }
  const entry = entries.get(key);
  if (entry && entry.raw === raw) return entry.value;
  const value = parse(raw);
  entries.set(key, { raw, value });
  return value;
}

function notify(key: FolderTreeStorageKey) {
  for (const listener of listeners.get(key) ?? []) listener();
}

function writeExpanded(key: FolderTreeStorageKey, next: readonly string[]) {
  const value = [...new Set(next)];
  try {
    const raw = JSON.stringify(value);
    localStorage.setItem(storageName(key), raw);
    entries.set(key, { raw, value });
    memory.delete(key);
  } catch {
    memory.set(key, value);
  }
  notify(key);
}

/**
 * Schreibt gemerkte Pfade um, nachdem ein Ordner verschoben oder umbenannt
 * wurde (oder das rückgängig gemacht): `from` und alles darunter heißen dann
 * `to…`. Wirkt auf jeden Baum mit diesem Schlüssel.
 */
export function renameExpandedPrefix(key: FolderTreeStorageKey, from: string, to: string): void {
  writeExpanded(key, renamePrefixPaths(readExpanded(key), from, to));
}

/** Klappt Ordner von außen auf, etwa den Elternordner, in den die Akte nach dem Löschen springt. */
export function expandFolders(key: FolderTreeStorageKey, paths: readonly string[]): void {
  writeExpanded(key, [...readExpanded(key), ...paths]);
}

function subscribe(key: FolderTreeStorageKey, listener: () => void): () => void {
  let set = listeners.get(key);
  if (!set) listeners.set(key, (set = new Set()));
  set.add(listener);
  // Ein anderer Tab hat geschrieben.
  const onStorage = (e: StorageEvent) => {
    if (e.key === storageName(key) || e.key === null) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    set.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

const noSubscribe = () => () => {};

/**
 * Der Aufklappzustand eines Baums (Spec § 5.2): je Nutzer und Baum im
 * Browser gemerkt, im Dialog (`key = null`) nur für die Dauer des Dialogs.
 * `expanded` ist eine stabile Referenz, solange sich nichts ändert —
 * Headless Tree baut neu, sobald sich die Identität seines Zustands ändert.
 */
export function useFolderTreeExpanded(
  key: FolderTreeStorageKey | null,
  existing: ReadonlySet<string>,
  selected: string | null,
  /** Nur ohne Schlüssel (Dialog): was beim Öffnen aufgeklappt ist, etwa der Weg zum aktuellen Ort. */
  initial: readonly string[] = []
): { expanded: string[]; setExpanded: (next: string[]) => void; renamePrefix: (from: string, to: string) => void } {
  const subscribeKey = useCallback((listener: () => void) => (key ? subscribe(key, listener) : noSubscribe()), [key]);
  // Auf dem Server und beim Hydrieren nichts Gemerktes, damit beide gleich zeichnen.
  const stored = useSyncExternalStore(subscribeKey, () => (key ? readExpanded(key) : EMPTY), () => EMPTY);
  const [local, setLocal] = useState<string[]>(() => [...initial]);
  const current = key ? stored : local;

  const expanded = useMemo(() => resolveExpanded(current, existing, selected), [current, existing, selected]);
  const setExpanded = useCallback((next: string[]) => (key ? writeExpanded(key, next) : setLocal([...new Set(next)])), [key]);
  const renamePrefix = useCallback(
    (from: string, to: string) => (key ? renameExpandedPrefix(key, from, to) : setLocal((prev) => renamePrefixPaths(prev, from, to))),
    [key]
  );

  return { expanded, setExpanded, renamePrefix };
}
