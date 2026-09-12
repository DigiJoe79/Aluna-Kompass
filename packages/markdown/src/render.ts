import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkDirective from 'remark-directive';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import type { Root as HastRoot, Element } from 'hast';
import { kompassConventions, literalUnknownDirectives } from './directives';
import { schema } from './sanitize';

function externalLinks() {
  return (tree: HastRoot) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName === 'a' && typeof node.properties?.href === 'string' && /^https?:\/\//.test(node.properties.href)) {
        node.properties.rel = ['noopener'];
      }
    });
  };
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkDirective)
  .use(literalUnknownDirectives)
  .use(kompassConventions)
  .use(remarkRehype)
  .use(externalLinks)
  .use(rehypeSanitize, schema)
  .use(rehypeStringify);

export async function renderMarkdown(markdown: string): Promise<string> {
  if (markdown.trim().length === 0) return '';
  const file = await processor.process(markdown);
  return String(file).trim();
}
