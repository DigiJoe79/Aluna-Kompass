'use client';

import { useEffect, useRef, useState } from 'react';

const signature = (filters: Record<string, string>) => JSON.stringify(Object.fromEntries(Object.entries(filters).map(([key, value]) => [key, value.trim()])));

/**
 * Filterfelder einer Liste, deren Filter in der Adresse leben.
 *
 * Die Felder brauchen eigenen Zustand, weil die Adresse dem Tippen nachläuft. Sie folgen ihr aber, wenn sie von
 * außen wechselt: Ein Klick auf den Eintrag in der Seitenleiste oder der Zurück-Knopf nimmt den Filter zurück,
 * und die Felder zeigten ihn sonst weiter (Befund vom 2026-09-30, erst Tierliste, dann Kontaktliste).
 *
 * Was die Liste selbst losgeschickt hat, steht in `sent` und wird nicht zurückgespielt – sonst fräße die
 * nachlaufende Adresse beim Tippen die jüngsten Buchstaben. `fromUrl` bei jedem Render mit denselben Schlüsseln
 * in derselben Reihenfolge übergeben.
 */
export function useUrlFilters<F extends Record<string, string>>(fromUrl: F): readonly [F, (next: F) => void] {
  const [filters, setFilters] = useState<F>(fromUrl);
  const sent = useRef<string[]>([]);
  const urlSignature = signature(fromUrl);
  useEffect(() => {
    const at = sent.current.indexOf(urlSignature);
    if (at >= 0) {
      sent.current = sent.current.slice(at + 1);
      return;
    }
    sent.current = [];
    setFilters((now) => (signature(now) === urlSignature ? now : (JSON.parse(urlSignature) as F)));
  }, [urlSignature]);
  const change = (next: F) => {
    setFilters(next);
    sent.current.push(signature(next));
  };
  return [filters, change] as const;
}
