import { describe, expect, it } from 'vitest';
import { allowlistHygiene, checkCountedAllowlist, type CountedAllowlist, openingTags, read, relative, sourceFiles, translate, translators } from './source';

/**
 * Textknopf (Designer Runde 4, „Eine Regel zur Klärung: Textknopf“; Entscheid Joe 2026-10-17; docs/MUSTER.md § B,
 * Knopfstufen): Ohne Rand (`ghost`) stehen nur „Abbrechen“, „Schließen“ und „Verwerfen“ — sie beenden nur und tun
 * nichts. Alles andere, was etwas tut, ist `outline`. Symbolknöpfe (×, ⋯, Pfeile: `size="icon…"` oder ohne Text) sind
 * ausgenommen. Der Wächter findet einen `Button` mit `variant="ghost"`, dessen Text — als Wort im Code oder über
 * `t('…')` aus der Sprachdatei — ein anderes Wort ist. Ausnahmen stehen gezählt mit Grund in der Liste.
 */
export const ALLOWED: CountedAllowlist = {
  // Der Kopf einer aufklappbaren Gruppe ist eine ganze Zeile („Finanzen · 2 von 5“): kein Knopf neben anderen, sondern
  // die Überschrift, die aufklappt (Runde 3, 158/179).
  'app/(shell)/admin/roles/role-editor.tsx': { count: 1, reason: 'Kopfzeile der aufklappbaren Rechtegruppe' },
  'app/(shell)/admin/themes/theme-editor.tsx': { count: 1, reason: 'Kopfzeile der aufklappbaren Tokengruppe' },
};

const WORDS = /^(Abbrechen|Schließen|Verwerfen)$/;

/** Der Text eines Knopfs: Wörter im Code und aufgelöste `t('…')`; ein unbekannter Schlüssel zählt als Text. */
function texts(body: string, ts: Map<string, string>): string[] {
  const out: string[] = [];
  const plain = body.replace(/<[^>]+>|\{[\s\S]*?\}/g, '').trim();
  if (plain && plain !== '×') out.push(plain);
  for (const call of body.matchAll(/\{(\w+)\('([\w.]+)'/g)) {
    const ns = ts.get(call[1]!);
    out.push(translate(ts, call[1]!, call[2]!) ?? `?${ns ? `${ns}.` : ''}${call[2]}`);
  }
  // Ein Ausdruck, der kein `t('…')` ist (`{label}`), ist Text, den der Wächter nicht kennt.
  if (/\{(?!\s*\w+\(')(?!\s*\/\*)[^}]*\}/.test(body.replace(/<[^>]+>/g, '')) && out.length === 0) out.push('?ausdruck');
  return out;
}

export function ghostHits(): { where: string; file: string; text: string }[] {
  return sourceFiles().flatMap((file) => {
    const text = read(file);
    if (!text.includes('ghost')) return [];
    const ts = translators(text);
    const found: { where: string; file: string; text: string }[] = [];
    let from = 0;
    for (const { line, tag } of openingTags(text, /Button/)) {
      const at = text.indexOf(tag, from);
      from = at + tag.length;
      if (!/variant=(?:"ghost"|\{[^}]*'ghost'[^}]*\})/.test(tag)) continue;
      if (/size=["'{][^\s]*icon/.test(tag)) continue;
      const body = tag.endsWith('/>') ? '' : text.slice(from, text.indexOf('</Button>', from));
      const words = texts(body, ts);
      if (words.length === 0) continue;
      if (words.every((w) => WORDS.test(w))) continue;
      found.push({ where: `${relative(file)}:${line} ${words.join(' / ')}`, file: relative(file), text: words.join(' / ') });
    }
    return found;
  });
}

describe('Textknopf nur für Abbrechen, Schließen, Verwerfen', () => {
  it('kein anderer `ghost`-Knopf mit Text', () => {
    expect(checkCountedAllowlist(ghostHits(), ALLOWED).unexpected).toEqual([]);
  });

  allowlistHygiene(ALLOWED, () => checkCountedAllowlist(ghostHits(), ALLOWED).stale);
});
