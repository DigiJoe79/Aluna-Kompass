import { describe, expect, it } from 'vitest';
import { openingTags, read, relative, sourceFiles } from './source';

/**
 * Kopf über der ⋯-Spalte nur für Vorleser (Designer Runde 4, Querschnitt, 112; docs/MUSTER.md § G, Zeilenaktionen):
 * Ein `TableHead col="actions"` trägt seinen Namen als `sr-only`, sichtbar steht dort nichts — und leer ist er auch
 * nicht, sonst fehlt Vorlesern der Spaltenname. Ausnahme: Spalten, deren Inhalt ein Wert ist (Schalter „Veröffentlicht“,
 * Wahl der Basis), tragen einen sichtbaren Kopf.
 */
const VISIBLE_HEAD: Record<string, string> = {
  'app/(shell)/animals/animal-list.tsx': 'Schalter „Veröffentlicht“ ist ein Wert, kein Menü',
  'app/(shell)/admin/documents/bases-panel.tsx': 'Wahl der Basis ist ein Wert, kein Menü',
};

function hits(): string[] {
  return sourceFiles().flatMap((file) => {
    const text = read(file);
    if (!text.includes('col="actions"')) return [];
    const out: string[] = [];
    let from = 0;
    for (const { line, tag } of openingTags(text, /TableHead/)) {
      const at = text.indexOf(tag, from);
      from = at + tag.length;
      if (!tag.includes('col="actions"')) continue;
      if (VISIBLE_HEAD[relative(file)]) continue;
      const body = tag.endsWith('/>') ? '' : text.slice(from, text.indexOf('</TableHead>', from));
      if (!/sr-only/.test(body)) out.push(`${relative(file)}:${line}`);
    }
    return out;
  });
}

describe('Kopf der ⋯-Spalte', () => {
  it('steht nur für Vorleser da', () => {
    expect(hits()).toEqual([]);
  });
});
