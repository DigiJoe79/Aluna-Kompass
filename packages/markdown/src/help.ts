import path from 'node:path';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkDirective from 'remark-directive';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import type { Root as HastRoot, Element, Text } from 'hast';
import type { Schema } from 'hast-util-sanitize';
import { kompassConventions, literalUnknownDirectives } from './directives';
import { schema } from './sanitize';

/** Wie das Brief-Schema, plus Bilder (nur relativ), tiefere Überschriften und `id` für Anker. */
const handbookSchema: Schema = {
  ...schema,
  tagNames: [...(schema.tagNames ?? []), 'img', 'h5', 'h6'],
  attributes: { ...schema.attributes, img: ['src', 'alt'], h2: ['id'], h3: ['id'], h4: ['id'], h5: ['id'], h6: ['id'] },
  protocols: { ...schema.protocols, src: [] },
  strip: ['script', 'style', 'iframe'],
};

const HAS_PROTOCOL = /^[a-z][a-z0-9+.-]*:/i;

/** `../bilder/akte/x.png` von `akte/post-ablegen` aus → `bilder/akte/x.png`; null, wenn es hinausführt. */
function resolveRelative(doc: string, href: string): string | null {
  const dir = path.posix.dirname(doc);
  const joined = path.posix.normalize(path.posix.join(dir === '.' ? '' : dir, href));
  return joined.startsWith('../') || joined === '..' || path.posix.isAbsolute(joined) ? null : joined;
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function textOf(node: Element): string {
  let out = '';
  visit(node, 'text', (t: Text) => { out += t.value; });
  return out;
}

function handbookLinks(doc: string) {
  return (tree: HastRoot) => {
    visit(tree, 'element', (node: Element, index, parent) => {
      if (node.tagName === 'img') {
        const src = typeof node.properties?.src === 'string' ? node.properties.src : '';
        const rel = HAS_PROTOCOL.test(src) || src.startsWith('/') ? null : resolveRelative(doc, src);
        if (!rel || !rel.startsWith('bilder/')) {
          if (parent && typeof index === 'number') parent.children.splice(index, 1);
          return index ?? undefined;
        }
        node.properties.src = `/help-bilder/${rel.slice('bilder/'.length)}`;
        return undefined;
      }
      if (node.tagName === 'a' && typeof node.properties?.href === 'string') {
        const href = node.properties.href;
        if (/^https?:\/\//.test(href)) node.properties.rel = ['noopener'];
        else if (!href.startsWith('#') && !HAS_PROTOCOL.test(href) && !href.startsWith('/')) {
          const [file, anchor] = href.split('#');
          const rel = file ? resolveRelative(doc, file) : null;
          if (rel && rel.endsWith('.md')) node.properties.href = `/help/${rel.slice(0, -3)}${anchor ? `#${anchor}` : ''}`;
        }
      }
      if (/^h[1-5]$/.test(node.tagName)) {
        node.tagName = `h${Number(node.tagName[1]) + 1}`;
        node.properties = { ...node.properties, id: slug(textOf(node)) };
      }
      return undefined;
    });
  };
}

/**
 * Das Handbuch in der App: Bilder aus `bilder/`, Links zwischen Seiten, und
 * alle Überschriften eine Stufe tiefer — das einzige `<h1>` bleibt die
 * Brotkrume der Schale.
 */
export async function renderHandbook(markdown: string, options: { doc: string }): Promise<string> {
  if (markdown.trim().length === 0) return '';
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkDirective)
    .use(literalUnknownDirectives)
    .use(kompassConventions)
    .use(remarkRehype)
    .use(handbookLinks, options.doc)
    .use(rehypeSanitize, handbookSchema)
    .use(rehypeStringify)
    .process(markdown);
  return String(file).trim();
}
