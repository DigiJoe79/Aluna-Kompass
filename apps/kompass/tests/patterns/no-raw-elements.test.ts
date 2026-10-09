import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkCountedAllowlist, type CountedAllowlist, isCommentLine, openingTags, read, relative, sourceFiles, SRC } from './source';

/**
 * Unter `src/app` keine rohen Bedien- und Tabellenelemente — `ui/*` bringt Höhe, Fokus, Dichte und Dunkelmodus
 * mit (K10 Charge 2, T4). `input type="hidden"` und `type="file"` (sr-only hinter Knopf oder Ablagefläche)
 * zählen nicht. Gezählt je Datei.
 */
const RAW = /button|input|select|textarea|table|thead|tbody|tr|th|td/;

export function rawElementLines(text: string): number[] {
  const lines = text.split('\n');
  return openingTags(text, RAW)
    .filter(({ tag, line }) => {
      const at = text.indexOf(tag);
      if (at > 0 && text[at - 1] === '`') return false; // `<table>` in Kommentar oder Doku
      if (isCommentLine(lines[line - 1] ?? '')) return false;
      if (/^<input\b/.test(tag) && /\btype=["'](?:hidden|file)["']/.test(tag)) return false;
      return true;
    })
    .map(({ line }) => line);
}

const ALLOWED: CountedAllowlist = {
  'app/(shell)/admin/themes/theme-preview.tsx': { count: 18, reason: 'Bildet Knöpfe und Tabelle nach, um die Theme-Farben zu zeigen.' },
  'app/global-error.tsx': { count: 1, reason: 'Ersetzt `<html>`, ohne Theme-Bausteine.' },
  'app/(shell)/admin/themes/theme-editor.tsx': { count: 2, reason: 'Listen-Auswahl der Themes, zweizeilig (Backlog: Baustein); Farbwert im Chip, der Chip ist der Rahmen (`Input` brächte Höhe, Rahmen, Fläche und Polster mit, die der Chip selbst trägt).' },
  'app/(shell)/admin/roles/role-editor.tsx': { count: 1, reason: 'Listen-Auswahl der Rollen, zweizeilig (Backlog: Baustein).' },
  'app/(shell)/finance/entries/[id]/correct-dialog.tsx': { count: 1, reason: 'Listen-Auswahl der Aufteilung, zweizeilig (Backlog: Baustein).' },
  'app/(shell)/dms/new/draft-screen.tsx': { count: 1, reason: 'Reiter nur unter 1180 px: `Tabs` blendet das inaktive Feld aus, ab 1180 px stehen Formular und Vorschau als zwei Spalten.' },
  'app/(shell)/finance/entries/entry-form.tsx': { count: 1, reason: 'Kandidaten-Knopf „offene Zahlung begleichen“, Listen-Auswahl zweizeilig (Backlog: Baustein).' },
};

describe('Heuristik', () => {
  it('trifft rohe Tags, auch mehrzeilig und mit Handler', () => {
    expect(rawElementLines('<button\n  onClick={() => a > b}\n>x</button>')).toEqual([1]);
    expect(rawElementLines('<div>\n<table className="x"><tr><td>1</td></tr></table>\n</div>')).toEqual([2, 2, 2]);
    expect(rawElementLines('<input type="number" />')).toEqual([1]);
  });
  it('trifft keine Bausteine, versteckte und Datei-Felder, Kommentare und Backticks', () => {
    expect(rawElementLines('<Button>x</Button><TableRow /><Input />')).toEqual([]);
    expect(rawElementLines('<input type="hidden" name="a" />\n<input\n  type="file"\n  className="sr-only" />')).toEqual([]);
    expect(rawElementLines('// ein <button> von Hand\n{/* statt rohem `<table>`: */}')).toEqual([]);
    expect(rawElementLines('<track kind="captions" /><thing />')).toEqual([]);
  });
});

describe('keine rohen Elemente unter src/app', () => {
  const hits = sourceFiles(path.join(SRC, 'app')).flatMap((file) =>
    rawElementLines(read(file)).map((line) => ({ where: `${relative(file)}:${line}`, file: relative(file) })),
  );

  it('Bedienelemente und Tabellen über ui/*; Ausnahmen mit Grund', () => {
    expect(checkCountedAllowlist(hits, ALLOWED).unexpected).toEqual([]);
  });

  it('keine vorläufigen Einträge mehr', () => {
    expect(Object.entries(ALLOWED).filter(([, { reason }]) => reason.startsWith('OFFEN')).map(([file]) => file)).toEqual([]);
  });

  it('jede Ausnahme ist noch nötig', () => {
    expect(checkCountedAllowlist(hits, ALLOWED).stale).toEqual([]);
  });
});
