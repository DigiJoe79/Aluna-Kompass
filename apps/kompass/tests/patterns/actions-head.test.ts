import { describe, expect, it } from 'vitest';
import { type Allowlist, allowlistHygiene, openingTags, read, relative, sourceFiles, staleKeys } from './source';

/**
 * Kopf über der ⋯-Spalte nur für Vorleser (Designer Runde 4, Querschnitt, 112; docs/MUSTER.md § G, Zeilenaktionen):
 * Ein `TableHead col="actions"` trägt seinen Namen als `sr-only`, sichtbar steht dort nichts — und leer ist er auch
 * nicht, sonst fehlt Vorlesern der Spaltenname. Ausnahme: Spalten, deren Inhalt ein Wert ist (Schalter „Veröffentlicht“,
 * Wahl der Basis), tragen einen sichtbaren Kopf.
 */
export const VISIBLE_HEAD: Allowlist = {
  'app/(shell)/animals/animal-list.tsx': 'Schalter „Veröffentlicht“ ist ein Wert, kein Menü',
  'app/(shell)/admin/documents/bases-panel.tsx': 'Wahl der Basis ist ein Wert, kein Menü',
};

function hits(): { where: string; file: string }[] {
  return sourceFiles().flatMap((file) => {
    const text = read(file);
    if (!text.includes('col="actions"')) return [];
    const out: { where: string; file: string }[] = [];
    let from = 0;
    for (const { line, tag } of openingTags(text, /TableHead/)) {
      const at = text.indexOf(tag, from);
      from = at + tag.length;
      if (!tag.includes('col="actions"')) continue;
      const body = tag.endsWith('/>') ? '' : text.slice(from, text.indexOf('</TableHead>', from));
      if (!/sr-only/.test(body)) out.push({ where: `${relative(file)}:${line}`, file: relative(file) });
    }
    return out;
  });
}

describe('Kopf der ⋯-Spalte', () => {
  it('steht nur für Vorleser da', () => {
    expect(hits().filter(({ file }) => !(file in VISIBLE_HEAD)).map(({ where }) => where)).toEqual([]);
  });

  allowlistHygiene(VISIBLE_HEAD, () => staleKeys(VISIBLE_HEAD, hits().map(({ file }) => file)));
});
