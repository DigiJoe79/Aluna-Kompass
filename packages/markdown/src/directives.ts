import type { Root } from 'mdast';
import { visit } from 'unist-util-visit';

/**
 * remark-Plugin: `:::karten` → Kartenraster; jede `###`-Überschrift eröffnet eine Karte.
 * Blockquotes → Hinweiskasten. Beides über hast-Daten, damit rehype die Elemente setzt.
 */
export function kompassConventions() {
  return (tree: Root) => {
    visit(tree, (node: any) => {
      if (node.type === 'containerDirective' && node.name === 'karten') {
        const cards: { type: 'card'; children: unknown[] }[] = [];
        for (const child of node.children) {
          if (child.type === 'heading' && child.depth === 3) cards.push({ type: 'card', children: [child] });
          else if (cards.length > 0) cards[cards.length - 1]!.children.push(child);
        }
        node.data = { hName: 'div', hProperties: { className: ['cards'] } };
        node.children = cards.map((card) => ({
          type: 'containerDirective',
          name: 'card',
          data: { hName: 'article', hProperties: { className: ['card'] } },
          children: card.children,
        })) as typeof node.children;
      }
      if (node.type === 'blockquote') {
        node.data = { hName: 'aside', hProperties: { className: ['note'] } };
      }
    });
  };
}
