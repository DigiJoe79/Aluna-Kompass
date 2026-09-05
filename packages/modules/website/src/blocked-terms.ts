export interface BlockedTermHit {
  path: string;
  term: string;
  excerpt: string;
}

function excerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + length + 30);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findBlockedTerms(content: unknown, terms: string[], filenames: string[] = []): BlockedTermHit[] {
  const needles = terms.map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 2);
  if (needles.length === 0) return [];
  const patterns = needles.map((term) => {
    const parts = term.split(/[\s_\-]+/).filter(Boolean).map(escapeRegex);
    const regex = new RegExp(parts.join('[\\s_\\-]+'), 'i');
    return { term, regex };
  });

  const hits: BlockedTermHit[] = [];
  const check = (value: string, path: string) => {
    for (const { term, regex } of patterns) {
      const match = value.match(regex);
      if (match && match.index !== undefined) {
        hits.push({ path, term, excerpt: excerptAround(value, match.index, match[0].length) });
      }
    }
  };
  const walk = (node: unknown, path: string) => {
    if (typeof node === 'string') check(node, path);
    else if (Array.isArray(node)) node.forEach((item, i) => walk(item, `${path}[${i}]`));
    else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
  };
  walk(content, '');
  for (const name of filenames) check(name, `files/${name}`);
  return hits;
}
