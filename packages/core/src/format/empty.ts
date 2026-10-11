/**
 * Der Leerwert (Durchsicht 0.2.11, Stufe 1, Auftrag 3; MUSTER § Leerwert, Wächter `no-raw-empty`): ein Geviertstrich
 * U+2014, ohne Rahmung. Für Texte, Attribute, `<option>` und Meldungen der Module; im JSX der App `<Empty />`
 * (`components/empty-value.tsx`), der ihn grau zeigt und zugänglich „keine Angabe“ nennt.
 */
export const EMPTY = '—';

/**
 * Namen statt Schlüssel (Stufe 1, Auftrag 6; MUSTER § Leerwert): Fehlt der Name eines Moduls, Rechts, einer
 * Dokumentart oder eines Projekts, steht `EMPTY` — nie der Schlüssel. Rein; den Hinweis in der Entwicklung gibt die
 * App (`apps/kompass/src/lib/name-or-empty.ts`).
 */
export function nameOrEmpty(name: string | null | undefined): string {
  return name ? name : EMPTY;
}
