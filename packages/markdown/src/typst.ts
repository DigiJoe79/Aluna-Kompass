import remarkDirective from 'remark-directive';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import type { Nodes, PhrasingContent, Root, RootContent } from 'mdast';

/**
 * Zeichen, die Typst als Markup oder Code deutet — im Fließtext neutralisiert.
 * `/` gehört dazu, weil Typst-Kommentare den Rest der Zeile (zwei Schrägstriche)
 * oder einen ganzen Abschnitt (Schrägstrich-Stern) verschlucken.
 */
const escapeChars = (s: string): string => s.replace(/[\\#$[\]*_`~@<>/]/g, (c) => `\\${c}`);

/**
 * Am Zeilenanfang liest Typst `=` als Überschrift, `-` und `+` als Aufzählung
 * und `2026.` als nummerierte Liste. Läuft nach {@link escapeChars}, damit die
 * hier gesetzten Backslashes nicht selbst noch einmal maskiert werden.
 */
const escapeLineStarts = (s: string): string =>
  s.replace(/(^|\n)([ \t]*)(=|[+-]|\d+\.)/g, (_match, start: string, indent: string, token: string) =>
    `${start}${indent}${token.endsWith('.') ? `${token.slice(0, -1)}\\.` : `\\${token}`}`);

const escapeText = (s: string): string => escapeLineStarts(escapeChars(s));

type Child = RootContent | PhrasingContent;

function inline(nodes: readonly Child[] | undefined): string {
  if (!nodes) return '';
  return nodes
    .map((node): string => {
      switch (node.type) {
        case 'text':
          return escapeText(node.value);
        case 'strong':
          return `*${inline(node.children)}*`;
        case 'emphasis':
          return `_${inline(node.children)}_`;
        case 'inlineCode':
          return '`' + node.value.replace(/`/g, '') + '`';
        case 'break':
          return ' \\\n';
        case 'delete':
          return `#strike[${inline(node.children)}]`;
        case 'link': {
          const url = String(node.url).replace(/[\\"]/g, '');
          return `#link("${url}")[${inline(node.children)}]`;
        }
        default:
          return 'children' in node ? inline(node.children as readonly Child[]) : '';
      }
    })
    .join('');
}

interface TableCell {
  children: PhrasingContent[];
}
interface TableRow {
  children: TableCell[];
}
interface ListItem {
  children: RootContent[];
}

/**
 * `:::karten` — jede `###`-Überschrift eröffnet eine Karte, wie im HTML-Weg
 * (`directives.ts`). Jede Karte wird ein eigener Inhaltsblock: als nackte
 * Argumente stünden Überschrift und Absatz als Ausdruck im Aufruf, und Typst
 * bricht ab. Text vor der ersten Karte steht vor dem Raster statt zu verschwinden.
 */
function karten(children: readonly Nodes[]): string {
  const lead: Nodes[] = [];
  const cards: Nodes[][] = [];
  for (const child of children) {
    if (child.type === 'heading' && child.depth === 3) cards.push([child]);
    else (cards[cards.length - 1] ?? lead).push(child);
  }
  const before = lead.map(block).join('\n');
  if (cards.length === 0) return `${before}\n`;
  const cells = cards.map((card) => `[\n${card.map(block).join('\n').trim()}\n]`);
  return `${before ? `${before}\n` : ''}#grid(columns: 2, gutter: 1em, ${cells.join(', ')})\n`;
}

function block(node: Nodes): string {
  switch (node.type) {
    case 'heading':
      return `${'='.repeat(node.depth)} ${inline(node.children)}\n`;
    case 'paragraph':
      return `${inline(node.children)}\n`;
    case 'thematicBreak':
      return '#line(length: 100%, stroke: 0.5pt + luma(70%))\n';
    case 'blockquote':
      return `#quote(block: true)[\n${node.children.map(block).join('\n')}\n]\n`;
    case 'list': {
      const marker = node.ordered ? '+' : '-';
      return (
        (node.children as unknown as ListItem[])
          .map((item) => `${marker} ${item.children.map(block).join(' ').trim()}`)
          .join('\n') + '\n'
      );
    }
    case 'code':
      return '```\n' + node.value.replace(/`/g, '') + '\n```\n';
    case 'table': {
      const rows = node.children as unknown as TableRow[];
      const cols = rows[0]?.children.length ?? 1;
      const cells = rows.flatMap((row) => row.children.map((cell) => `[${inline(cell.children)}]`));
      return `#table(\n  columns: ${cols},\n  ${cells.join(', ')}\n)\n`;
    }
    default: {
      const directive = node as { type: string; name?: string; children?: Nodes[] };
      if (directive.type === 'containerDirective' && directive.children) {
        if (directive.name === 'karten') return karten(directive.children);
        return `${directive.children.map(block).join('\n')}\n`;
      }
      return '';
    }
  }
}

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkDirective);

export async function renderMarkdownTypst(markdown: string): Promise<string> {
  if (markdown.trim().length === 0) return '';
  const tree = parser.parse(markdown);
  const processed = (await parser.run(tree)) as Root;
  return processed.children.map((child) => block(child as Nodes)).join('\n').trim();
}
