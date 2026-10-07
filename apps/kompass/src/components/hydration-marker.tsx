'use client';

import { useEffect } from 'react';

/** Wie viele Marker gerade stehen — eine Seite kann mehrere Rahmen tragen (`Page` um eine `ForbiddenCard`). */
let mounted = 0;

/**
 * Sagt der Seite an, dass React ihren Inhalt übernommen hat.
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
 * Steht im Rahmen der Seite, nicht im Wurzel-Layout: `Page` (jede Seite der
 * Schale, `tests/patterns/page-width.test.ts`), `ForbiddenCard` und
 * `AuthCard` (Anmeldung, Passwort, Einrichtung). Die Schale strömt ihren
 * Inhalt hinter der Suspense-Grenze von `(shell)/loading.tsx`, und React
 * hydriert eine solche Grenze in einem eigenen Durchgang. Im Wurzel-Layout
 * meldete der Marker deshalb „hydriert“, sobald die Schale stand — unter Last
 * auch dann, wenn darunter noch das Skelett lag oder der Inhalt erst zum Teil
 * hydriert war (gemessen: 19 von 40 Seitenaufrufen). Im Rahmen läuft der
 * Effekt im selben Durchgang wie der Inhalt, und als letztes Kind nach den
 * Effekten aller Geschwister davor; die Schale samt `ShellFrame`, der auf die
 * Taste `?` hört, ist dann schon hydriert, weil sie ausserhalb der Grenze
 * liegt.
 *
 * Bei einem Seitenwechsel im Client verschwindet der Marker mit der alten
 * Seite und kommt mit der neuen wieder.
 *
 * Gelesen wird das Attribut von `e2e/fixtures.ts`. Rendert nichts.
 */
export function HydrationMarker() {
  useEffect(() => {
    mounted += 1;
    document.documentElement.dataset.hydrated = 'true';
    return () => {
      mounted -= 1;
      if (mounted === 0) delete document.documentElement.dataset.hydrated;
    };
  }, []);
  return null;
}
