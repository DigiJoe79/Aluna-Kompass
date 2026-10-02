/**
 * Der nächste Vorfahr von `el`, der scrollen kann (`overflow-y` ist `auto` oder
 * `scroll`), oder `null`, wenn keiner da ist — dann scrollt die Seite.
 *
 * `requireOverflow: true` verlangt zusätzlich, dass er gerade wirklich scrollt
 * (`scrollHeight > clientHeight`). Das braucht, wer wissen will, *was sich
 * bewegt*, etwa das Randscrollen oder die Ablagefläche: Eine Spalte mit
 * `overflow-auto`, deren Inhalt passt, zählt dann nicht, der Arbeitsbereich
 * dahinter schon. Ohne die Option zählt jeder Kandidat, auch wenn er heute
 * nichts zu scrollen hat — richtig für den, der sich an ihm festmachen will,
 * bevor er überläuft.
 */
export function scrollContainerOf(el: Element, { requireOverflow = false }: { requireOverflow?: boolean } = {}): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY !== 'auto' && overflowY !== 'scroll') continue;
    if (!requireOverflow || node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}
