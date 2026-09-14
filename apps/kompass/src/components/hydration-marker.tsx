'use client';

import { useEffect } from 'react';

/**
 * Sagt der Seite an, dass React sie übernommen hat.
 *
 * Bis dahin steht sie vollständig da — servergerendert, sichtbar, anklickbar —
 * und tut nichts: Ein Klick läuft ins Leere, ein Tastendruck geht an ein
 * Fenster, das noch nicht zuhört. Von aussen ist dieser Zustand nicht von einer
 * fertigen Seite zu unterscheiden, und genau daran sind vier CI-Läufe
 * gescheitert.
 *
 * Gemessen an einer gebremsten Seite liegen zwischen dem ersten hydrierten
 * Element (1324 ms) und der fertigen Kopfleiste (1376 ms) 52 Millisekunden, und
 * die Effekte laufen noch danach. Auf solche Abstände lässt sich von aussen
 * nichts bauen; deshalb sagt die Anwendung es selbst.
 *
 * Steht als letztes Kind im Layout: React führt die Effekte in Baumreihenfolge
 * aus, dieser läuft also nach denen aller Geschwister davor — auch nach dem des
 * `ShellFrame`, der auf die Taste `?` hört.
 *
 * Gelesen wird das Attribut von `e2e/fixtures.ts`.
 */
export function HydrationMarker() {
  useEffect(() => {
    document.documentElement.dataset.hydrated = 'true';
    return () => {
      delete document.documentElement.dataset.hydrated;
    };
  }, []);
  return null;
}
