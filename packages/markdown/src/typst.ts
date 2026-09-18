import remarkDirective from 'remark-directive';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import type { Nodes, PhrasingContent, Root, RootContent } from 'mdast';
import { literalUnknownDirectives, splitCards } from './directives';

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

/** Dieselbe Liste wie `sanitize.ts` im HTML-Weg. */
const ALLOWED_PROTOCOLS = new Set(['http', 'https', 'mailto', 'tel']);

/**
 * Wie `hast-util-sanitize`: ein Doppelpunkt zählt nur als Schema, wenn er vor
 * dem ersten `/`, `?` oder `#` steht. Alles ohne Schema bleibt erlaubt.
 */
function isAllowedUrl(url: string): boolean {
  const colon = url.indexOf(':');
  if (colon < 0) return true;
  const stop = url.search(/[/?#]/);
  if (stop >= 0 && stop < colon) return true;
  return ALLOWED_PROTOCOLS.has(url.slice(0, colon).toLowerCase());
}

/** Folgezeilen eines Listeneintrags einrücken — sonst fällt ein Unterpunkt auf die Ebene des Elternteils zurück. */
const indentContinuation = (s: string): string =>
  s
    .split('\n')
    .map((line, index) => (index === 0 || line === '' ? line : `  ${line}`))
    .join('\n');

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
          // Ein abgelehntes Schema verliert den Verweis, nicht den Text.
          if (!isAllowedUrl(url)) return inline(node.children);
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
  const { lead, cards } = splitCards(children);
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
          .map((item) => `${marker} ${indentContinuation(item.children.map(block).join('\n').trim())}`)
          .join('\n') + '\n'
      );
    }
    case 'code':
      return '```\n' + node.value.replace(/`/g, '') + '\n```\n';
    case 'table': {
      const [head, ...body] = node.children as unknown as TableRow[];
      const cols = head?.children.length ?? 1;
      const cell = (c: TableCell): string => `[${inline(c.children)}]`;
      // Erste Zeile als `table.header`: nur so wiederholt Typst sie über den Seitenumbruch.
      const header = head ? `  table.header(${head.children.map(cell).join(', ')}),\n` : '';
      const align = node.align ?? [];
      const alignment = align.some((a) => a)
        ? `  align: (${Array.from({ length: cols }, (_, i) => align[i] ?? 'auto').join(', ')}),\n`
        : '';
      const cells = body.flatMap((row) => row.children.map(cell));
      const rest = cells.length > 0 ? `  ${cells.join(', ')}\n` : '';
      return `#table(\n  columns: ${cols},\n${alignment}${header}${rest})\n`;
    }
    default: {
      const directive = node as { type: string; name?: string; children?: Nodes[] };
      if (directive.type === 'leafDirective' && directive.name === 'seitenumbruch') {
        // `weak`: am Seitenanfang bleibt der Umbruch aus, statt eine leere Seite zu öffnen.
        return '#pagebreak(weak: true)\n';
      }
      if (directive.type === 'containerDirective' && directive.children) {
        if (directive.name === 'karten') return karten(directive.children);
        return `${directive.children.map(block).join('\n')}\n`;
      }
      return '';
    }
  }
}

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkDirective).use(literalUnknownDirectives);

export async function renderMarkdownTypst(markdown: string): Promise<string> {
  if (markdown.trim().length === 0) return '';
  const tree = parser.parse(markdown);
  // Der Quelltext muss mit: das Direktiven-Plugin schneidet aus ihm den Originalwortlaut.
  const processed = (await parser.run(tree, markdown)) as Root;
  return processed.children.map((child) => block(child as Nodes)).join('\n').trim();
}
