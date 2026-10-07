import { createCn } from 'cn/config';

/**
 * Die Schriftrollen aus `app/globals.css` (K10). `cn` muss sie kennen: Sonst hält die Zusammenführung
 * `text-meta` für eine Textfarbe, und `cn('text-meta text-muted-ink')` ließe nur die Farbe übrig.
 */
export const TYPE_ROLES = ['dialog-title', 'section', 'body', 'meta', 'hint', 'figure'] as const;

export const cn = createCn({ extend: { classGroups: { 'font-size': [{ text: [...TYPE_ROLES] }] } } });

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
}
