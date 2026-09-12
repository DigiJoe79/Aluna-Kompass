import type { Root } from 'mdast';
import { SKIP, visit } from 'unist-util-visit';

/** Direktiven, die Kompass kennt. Die Container-Form steht in `kompassConventions`. */
const KNOWN_LEAF_DIRECTIVES = new Set(['seitenumbruch']);

/**
 * remark-Plugin: `remark-directive` liest jedes `:wort` als Direktive — auch die
 * Minuten in `15:00` und die Zahl in `2:1`, die danach spurlos fehlten. Was nicht
 * auf der Liste steht, kommt als der Text zurück, der dastand; wiederhergestellt
 * aus der Quelle, damit die Schreibweise genau erhalten bleibt.
 */
export function literalUnknownDirectives() {
  return (tree: Root, file: { value?: unknown }) => {
    const source = String(file.value ?? '');
    visit(tree, (node: any, index, parent: any) => {
      if (parent == null || index == null) return;
      if (node.type !== 'textDirective' && node.type !== 'leafDirective') return;
      if (node.type === 'leafDirective' && KNOWN_LEAF_DIRECTIVES.has(node.name)) return;
      const from = node.position?.start?.offset;
      const to = node.position?.end?.offset;
      if (from == null || to == null) return;
      const value = source.slice(from, to);
      parent.children[index] =
        node.type === 'textDirective'
          ? { type: 'text', value }
          : { type: 'paragraph', children: [{ type: 'text', value }] };
      return SKIP;
    });
  };
}

/**
 * Teilt den Inhalt eines `:::karten`-Blocks: jede `###`-Überschrift eröffnet eine
 * Karte, alles davor bleibt Vorspann. Beide Wandler teilen hier gleich, damit
 * Brief und Webseite denselben Text zeigen.
 */
export function splitCards<T extends { type: string; depth?: number }>(children: readonly T[]): { lead: T[]; cards: T[][] } {
  const lead: T[] = [];
  const cards: T[][] = [];
  for (const child of children) {
    if (child.type === 'heading' && child.depth === 3) cards.push([child]);
    else (cards[cards.length - 1] ?? lead).push(child);
  }
  return { lead, cards };
}

/**
 * remark-Plugin: `:::karten` → Kartenraster; jede `###`-Überschrift eröffnet eine Karte.
 * Blockquotes → Hinweiskasten. Beides über hast-Daten, damit rehype die Elemente setzt.
 */
export function kompassConventions() {
  return (tree: Root) => {
    visit(tree, (node: any, index, parent: any) => {
      if (node.type === 'containerDirective' && node.name === 'karten' && parent != null && index != null) {
        const { lead, cards } = splitCards(node.children);
        // Ohne Karte bleibt der Inhalt einfacher Text statt eines leeren Rasters.
        if (cards.length === 0) {
          parent.children.splice(index, 1, ...lead);
          return [SKIP, index + lead.length];
        }
        node.children = cards.map((card) => ({
          type: 'containerDirective',
          name: 'card',
          data: { hName: 'article', hProperties: { className: ['card'] } },
          children: card,
        })) as typeof node.children;
        node.data = { hName: 'div', hProperties: { className: ['cards'] } };
        // Der Vorspann steht vor dem Raster, statt wie früher zu verschwinden.
        parent.children.splice(index, 0, ...lead);
        return [SKIP, index + lead.length + 1];
      }
      if (node.type === 'blockquote') {
        node.data = { hName: 'aside', hProperties: { className: ['note'] } };
      }
    });
  };
}
