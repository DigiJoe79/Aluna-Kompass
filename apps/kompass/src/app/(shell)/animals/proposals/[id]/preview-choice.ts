'use client';

import { useSyncExternalStore } from 'react';
import type { PreviewChoice } from '../preview';

/*
 * Die Wahl der Prüfseite für die Vorschau im Kopf (Board 7b): Der Knopf „Vorschau“ steht im `PageHeader`, die Wahl
 * lebt in der Gegenüberstellung darunter — beide sind getrennte Client-Inseln. Ein kleiner Speicher je Vorschlag
 * verbindet sie, ohne die Seite in einen gemeinsamen Client-Baum zu ziehen.
 */
const choices = new Map<string, PreviewChoice>();
const listeners = new Set<() => void>();
const EMPTY: PreviewChoice = {};

export function setPreviewChoice(id: string, choice: PreviewChoice): void {
  choices.set(id, choice);
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function usePreviewChoice(id: string): PreviewChoice {
  return useSyncExternalStore(subscribe, () => choices.get(id) ?? EMPTY, () => EMPTY);
}
