'use client';

import { useEffect, useRef } from 'react';

/**
 * Ein verstecktes Feld meldet keine Eingabe, wenn React seinen Wert setzt. Die Speicherleiste (`FormActionBar`)
 * zählt Änderungen aber nur, wenn das Formular ein `input` hört — ohne diesen Haken blieb etwa ein getauschter
 * Empfänger im Brief-Entwurf „Nichts geändert“ und wurde nie gespeichert (Joe 2026-10-18). Der erste Wert meldet
 * nichts; jeder spätere andere Wert genau einmal. Muster wie in `MediaPicker`.
 */
export function useHiddenInputEvent(value: string) {
  const ref = useRef<HTMLInputElement>(null);
  const seen = useRef(value);
  useEffect(() => {
    if (seen.current === value) return;
    seen.current = value;
    ref.current?.dispatchEvent(new Event('input', { bubbles: true }));
  }, [value]);
  return ref;
}
