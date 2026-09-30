import type { AnimalListInput } from '@kompass/module-animals';
import type { QueuePosition } from '@/lib/queue-position';
import { readSort } from '@/lib/sort';

/** Die Query-Parameter der Tierliste. Dieselben reisen in die Maske mit (Warteschlange). */
export const LIST_PARAM_KEYS = ['text', 'status', 'location', 'published', 'review', 'sort', 'dir'] as const;
export type AnimalListQuery = Partial<Record<(typeof LIST_PARAM_KEYS)[number], string>>;

/** Sortierbar in der Oberfläche; der Dienst kennt mehr Felder. */
export const SORTABLE = ['name', 'updatedAt'] as const;

export const LIST_STATUSES = ['lookingForHome', 'reserved', 'adopted'] as const;
export const LIST_LOCATIONS = ['shelter', 'germany'] as const;

/** So lang nimmt `listAnimals` den Suchtext; länger wäre ein Validierungsfehler statt einer Liste. */
const TEXT_MAX = 80;

const oneOf = <T extends string>(allowed: readonly T[], value: string | undefined): T | undefined => allowed.find((a) => a === value);

/**
 * URL → Eingabe für `listAnimals`. Unbekannte Werte werden überlesen: Ein
 * vertippter oder veralteter Link zeigt die ganze Liste statt eines Fehlers.
 */
export function animalListInput(q: AnimalListQuery): AnimalListInput {
  const input: AnimalListInput = {};
  const text = (q.text ?? '').trim().slice(0, TEXT_MAX);
  if (text) input.text = text;
  const status = oneOf(LIST_STATUSES, q.status);
  if (status) input.status = status;
  const location = oneOf(LIST_LOCATIONS, q.location);
  if (location) input.location = location;
  if (q.published === '1') input.isPublished = true;
  if (q.published === '0') input.isPublished = false;
  const review = q.review === '1';
  if (review) input.reviewPending = true;
  // Ohne eigene Wahl steht in „Prüfung offen“ oben, was am längsten wartet; sonst nimmt der Dienst den Namen.
  const orderBy = readSort(q, SORTABLE) ?? (review ? { field: 'reviewRequestedAt' as const, direction: 'asc' as const } : undefined);
  if (orderBy) input.orderBy = orderBy;
  return input;
}

/** Nur die bekannten, nicht leeren Listenparameter, als Query-String ohne `?` (leer, wenn keiner gesetzt ist). */
export function listQueryString(q: Record<string, string | undefined>): string {
  const next = new URLSearchParams();
  for (const key of LIST_PARAM_KEYS) {
    const value = q[key];
    if (value) next.set(key, value);
  }
  return next.toString();
}

/** Ob überhaupt ein Filter wirkt — Sortierung ist keiner. Trennt „kein Treffer“ von „noch kein Hund“. */
export function hasListFilter(q: AnimalListQuery): boolean {
  const { orderBy: _orderBy, ...filters } = animalListInput(q);
  return Object.keys(filters).length > 0;
}

/**
 * Die Warteschlange einer Maske: die Liste, aus der man kam. `query` ist deren
 * Query-String (ohne `tab`); `position` fehlt, wenn der Hund nicht (mehr) in
 * der Auswahl steht – dann bleibt nur der Rückweg.
 */
export interface AnimalQueue {
  query: string;
  position: QueuePosition | null;
}

/** Die Reiter der Maske; der gewählte reist als `tab` in der URL zum nächsten Hund mit. */
export const FORM_TABS = ['profile', 'content', 'story'] as const;
export type FormTab = (typeof FORM_TABS)[number];
export const formTab = (value: string | undefined): FormTab => FORM_TABS.find((tab) => tab === value) ?? 'profile';
