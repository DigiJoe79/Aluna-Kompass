import { describe, expect, it } from 'vitest';
import messages from '../../messages/de.json';
import { checkCountedAllowlist, type CountedAllowlist, lineOf, read, relative, sourceFiles } from './source';

/**
 * Zeilenaktionen stehen im ⋯-Menü (`RowMenu`), auf allen Breiten, auch bei einer Aktion (Joe 11.8, Designer Runde 3
 * Teil 1 Nr. 2; docs/MUSTER.md § G). Der Wächter findet in einer `TableCell` einen Knopf (`Button` oder ein Element mit
 * `buttonVariants`) mit dem Text „Bearbeiten“, „Löschen“, „Ändern“, „Entfernen“ oder „Widerrufen“ — als Wort im Code
 * oder über `t('…')` aus der Sprachdatei. Ausnahmen (das × in Unterlisten von Formularen ist kein Text, Knöpfe, die
 * die Arbeit der Liste sind) stehen gezählt mit Grund in der Liste.
 */
const ALLOWED: CountedAllowlist = {};

const WORDS = /^(Bearbeiten|Löschen|Ändern|Entfernen|Widerrufen)( …)?$/;

function lookup(path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined), messages);
}

/** Die Übersetzer der Datei: Variable → Namensraum (`const t = useTranslations('dms.admin')`). */
function translators(text: string): Map<string, string> {
  return new Map([...text.matchAll(/const (\w+) = (?:await )?(?:useTranslations|getTranslations)\('([^']+)'\)/g)].map((m) => [m[1]!, m[2]!]));
}

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
          const ns = ts.get(call[1]!);
          const value = ns ? lookup(`${ns}.${call[2]}`) : undefined;
          if (typeof value === 'string') texts.push(value);
        }
        if (texts.some((t) => WORDS.test(t))) found.push({ where: `${relative(file)}:${lineOf(text, cell.index! + button.index!)}`, file: relative(file) });
      }
    }
    return found;
  });
}

describe('Zeilenaktionen im ⋯-Menü', () => {
  it('kein Knopf „Bearbeiten“, „Löschen“, „Ändern“, „Entfernen“ oder „Widerrufen“ in einer Tabellenzelle', () => {
    const { unexpected, stale } = checkCountedAllowlist(hits(), ALLOWED);
    expect(unexpected).toEqual([]);
    expect(stale).toEqual([]);
  });
});
