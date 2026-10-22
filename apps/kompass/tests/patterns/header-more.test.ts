import { describe, expect, it } from 'vitest';
import { allowlistHygiene, attributeExpression, checkCountedAllowlist, type CountedAllowlist, openingTags, read, relative, sourceFiles } from './source';

/**
 * Kopfaktionen am Telefon (Runde 3, 018; Joe 2026-10-17; docs/MUSTER.md § Seitenrahmen): Im Seitenkopf bleibt am
 * Telefon nur der Primärknopf, die übrigen Kopfaktionen stehen im ⋯. Dafür gehören Nebenaktionen nicht frei in
 * `PageHeader actions`, sondern als Liste in `PageHeader more` — ab `sm` stehen sie als `outline`-Knöpfe vor den
 * Aktionen, am Telefon im ⋯ (zusammen mit `RecordActions`, falls die Seite eines hat).
 *
 * Der Wächter findet in `actions={…}` eines `PageHeader` einen Knopf der Stufe `outline` (`variant="outline"` bzw.
 * `variant: 'outline'`). Was ein eigener Baustein darin rendert, sieht er nicht; Ausnahmen stehen gezählt mit Grund in
 * der Liste.
 */
export const ALLOWED: CountedAllowlist = {};

const OUTLINE = /variant(?:=\{?\s*|:\s*)["']outline["']/g;

/** Der Ausdruck im Attribut `actions={…}` des Tags selbst, bis zur passenden Klammer. */
export const actionsExpression = (tag: string): string | null => attributeExpression(tag, 'actions');

function hits(): { where: string; file: string }[] {
  return sourceFiles().flatMap((file) => {
    const text = read(file);
    if (!text.includes('<PageHeader')) return [];
    return openingTags(text, /PageHeader/).flatMap(({ line, tag }) => {
      const expression = actionsExpression(tag);
      if (!expression) return [];
      return [...expression.matchAll(OUTLINE)].map(() => ({ where: `${relative(file)}:${line}`, file: relative(file) }));
    });
  });
}

describe('Kopfaktionen am Telefon', () => {
  it('erkennt einen outline-Knopf in actions, nicht in more', () => {
    const tag = `<PageHeader title="x" more={[{ key: 'a', label: 'A', href: '/a' }]} actions={<><Link className={buttonVariants({ variant: 'outline' })} href="/b">B</Link><Button>C</Button></>} />`;
    expect([...(actionsExpression(tag) ?? '').matchAll(OUTLINE)]).toHaveLength(1);
    expect(actionsExpression(`<PageHeader title="x" actions={<Button variant="outline">B</Button>} />`)).toContain('outline');
    expect(actionsExpression(`<PageHeader title="x" />`)).toBeNull();
  });

  it('kein outline-Knopf in PageHeader actions — Nebenaktionen gehören in more', () => {
    expect(checkCountedAllowlist(hits(), ALLOWED).unexpected).toEqual([]);
  });

  allowlistHygiene(ALLOWED, () => checkCountedAllowlist(hits(), ALLOWED).stale);
});
