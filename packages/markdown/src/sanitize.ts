import { defaultSchema, type Schema } from 'hast-util-sanitize';

export const schema: Schema = {
  ...defaultSchema,
  tagNames: ['h1', 'h2', 'h3', 'h4', 'p', 'em', 'strong', 'a', 'ul', 'ol', 'li', 'br', 'hr', 'aside', 'div', 'article', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'code', 'pre', 'del'],
  attributes: {
    a: ['href', 'rel'],
    aside: ['className'],
    div: ['className'],
    article: ['className'],
    th: ['align'],
    td: ['align'],
  },
  protocols: { href: ['http', 'https', 'mailto', 'tel'] },
  clobberPrefix: '',
  strip: ['script', 'style', 'img', 'iframe'],
};
