import remarkDirective from 'remark-directive';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import type { Nodes, PhrasingContent, Root, RootContent } from 'mdast';

/** Zeichen, die Typst als Markup oder Code deutet — im Fließtext neutralisiert. */
const escapeText = (s: string): string => s.replace(/[\\#$[\]*_`~@<>]/g, (c) => `\\${c}`);

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
        const inner = directive.children.map(block).join('\n');
        if (directive.name === 'karten') return `#grid(columns: 2, gutter: 1em, ${inner})\n`;
        return `${inner}\n`;
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
