/**
 * Rückfrage beim Verlassen einer Formularseite mit ungespeicherten Änderungen (Befund 39, Designer 2026-10-08).
 * Die Speicherleiste (`FormActionBar`, Lage `page`) fängt damit Klicks auf Links ab; Neuladen, Schließen und fremde
 * Adressen übernimmt der Browser über `beforeunload`.
 *
 * Ob ein Klick die Seite verlässt: ein gewöhnlicher Linksklick ohne Taste auf einen Link derselben Herkunft, der
 * woanders hinführt. Nicht abgefangen werden:
 * - Klicks mit Strg/Cmd/Umschalt/Alt oder der mittleren Taste — sie öffnen einen Tab, die Seite bleibt;
 * - `target="_blank"` und `download` — ebenso;
 * - fremde Herkunft — dort fragt der Browser selbst (`beforeunload`);
 * - ein Sprung auf derselben Seite (nur `#…`);
 * - ein Link **in der Formularkarte** auf denselben Pfad: Das ist ein Bereichswechsel, den das Formular selbst
 *   führt (Einstellungen → Verein, `?panel=`) — es bleibt stehen, und die Eingaben mit ihm.
 */
export function leavingLink(event: MouseEvent, here: { href: string }, form?: Element | null): HTMLAnchorElement | null {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const target = event.target;
  const link = target instanceof Element ? target.closest('a[href]') : null;
  if (!link || !(link instanceof HTMLAnchorElement)) return null;
  if (link.hasAttribute('download') || (link.target && link.target !== '_self')) return null;
  const from = new URL(here.href);
  const to = new URL(link.href, from);
  if (to.origin !== from.origin) return null;
  if (to.pathname === from.pathname && to.search === from.search) return null;
  if (to.pathname === from.pathname && form?.contains(link)) return null;
  return link;
}
