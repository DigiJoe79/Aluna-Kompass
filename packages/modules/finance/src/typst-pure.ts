/**
 * Formatierung und Typst-Bausteine der Modul-Vorlagen — rein, ohne Import.
 * Neutraler Boden seit F8a: Die Zuwendungsbestätigungen (`donations/`) und
 * die Verzichtserklärung (`allocation/`) brauchen dieselben, und `allocation/`
 * darf `donations/` nicht kennen (`direction.test.ts`).
 */

/** ISO → TT.MM.JJJJ. */
export function germanDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

/** 123456 → „1.234,56 €“ — ohne Intl, damit das PDF nicht an der ICU-Fassung hängt. */
export function formatCents(value: number): string {
  const euros = String(Math.floor(value / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${euros},${String(value % 100).padStart(2, '0')} €`;
}

/**
 * Freitext als Typst-String-Ausdruck: `#"…";`. Nichts darin wirkt als Markup
 * (kein `#`, `$`, `*`, keine Liste am Zeilenanfang); das Semikolon beendet den
 * Ausdruck, damit ein folgender Punkt kein Feldzugriff wird.
 */
export function typstText(value: string): string {
  return `#"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')}";`;
}
