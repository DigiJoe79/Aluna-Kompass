import { describe, expect, it } from 'vitest';
import { allowlistHygiene, checkCountedAllowlist, type CountedAllowlist, lineOf, read, relative, sourceFiles, translate, translators } from './source';

/**
 * Zeilenaktionen stehen im ⋯-Menü (`RowMenu`), auf allen Breiten, auch bei einer Aktion (Joe 11.8, Designer Runde 3
 * Teil 1 Nr. 2; docs/MUSTER.md § G). Der Wächter findet in einer `TableCell` einen Knopf (`Button` oder ein Element mit
 * `buttonVariants`) mit dem Text „Bearbeiten“, „Löschen“, „Ändern“, „Entfernen“ oder „Widerrufen“ — als Wort im Code
 * oder über `t('…')` aus der Sprachdatei. Ausnahmen (das × in Unterlisten von Formularen ist kein Text, Knöpfe, die
 * die Arbeit der Liste sind) stehen gezählt mit Grund in der Liste.
 */
export const ALLOWED: CountedAllowlist = {};

const WORDS = /^(Bearbeiten|Löschen|Ändern|Entfernen|Widerrufen)( …)?$/;

function hits(): { where: string; file: string }[] {
  return sourceFiles().flatMap((file) => {
    const text = read(file);
    if (!text.includes('<TableCell')) return [];
    const ts = translators(text);
    const found: { where: string; file: string }[] = [];
    for (const cell of text.matchAll(/<TableCell\b[\s\S]*?<\/TableCell>/g)) {
      for (const button of cell[0].matchAll(/<(Button|Link|a)\b([^>]|=>)*?>([\s\S]*?)<\/\1>/g)) {
        if (button[1] !== 'Button' && !/buttonVariants/.test(button[0])) continue;
        const body = button[3]!;
        const texts = [body.replace(/<[^>]+>|\{[^}]*\}/g, '').trim()];
        for (const call of body.matchAll(/\{(\w+)\('([\w.]+)'/g)) {
          const value = translate(ts, call[1]!, call[2]!);
          if (value !== undefined) texts.push(value);
        }
        if (texts.some((t) => WORDS.test(t))) found.push({ where: `${relative(file)}:${lineOf(text, cell.index! + button.index!)}`, file: relative(file) });
      }
    }
    return found;
  });
}

describe('Zeilenaktionen im ⋯-Menü', () => {
  it('kein Knopf „Bearbeiten“, „Löschen“, „Ändern“, „Entfernen“ oder „Widerrufen“ in einer Tabellenzelle', () => {
    expect(checkCountedAllowlist(hits(), ALLOWED).unexpected).toEqual([]);
  });

  allowlistHygiene(ALLOWED, () => checkCountedAllowlist(hits(), ALLOWED).stale);
});
