import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Allowlist, inFileOrLocalImport, openingTags, read, relative, SRC, sourceFiles } from './source';

/**
 * Filterleisten (docs/MUSTER.md § L, Spec 2026-10-08 § 5): Jede Liste mit Suche oder Filtern nutzt `FilterBar`,
 * Suchfelder sind `SearchField` (Lupe und ✕), Reiter über Listen sind `ViewTabs` (Links mit `aria-current`, kein
 * `role="tablist"`). Drei Heuristiken auf den Dateien unter `src/app`; Ausnahmen je Datei mit Grund.
 */
const APP = path.join(SRC, 'app');

/** Ein `<Input …>` als Suchfeld: `type="search"` oder ein Platzhalter/Name aus einem Such-Schlüssel. */
export function rawSearchInputs(text: string): number[] {
  return openingTags(text, /Input/)
    .filter(({ tag }) => /type="search"/.test(tag) || /(placeholder|aria-label)=\{\w*\('[\w.]*[sS]earch[\w.]*'\)\}/.test(tag))
    .map(({ line }) => line);
}

/** `role="tablist"` an einem Element, das Links enthält: Reiter, die eine Adresse wechseln, sind `ViewTabs`. */
export function linkTablists(text: string): number[] {
  const found: number[] = [];
  for (let at = text.indexOf('role="tablist"'); at !== -1; at = text.indexOf('role="tablist"', at + 1)) {
    // Bis zum Ende des Elements, grob: die nächste schließende Hülle.
    const end = text.slice(at).search(/<\/(div|nav|ul)>/);
    const body = text.slice(at, end === -1 ? undefined : at + end);
    if (/<Link\b|\shref=/.test(body)) found.push(text.slice(0, at).split('\n').length);
  }
  return found;
}

const usesUrlFilters = (text: string) => /\buseUrlFilters\s*[<(]/.test(text);

const RAW_SEARCH_ALLOWED: Allowlist = {
  'app/(shell)/finance/entries/entry-form.tsx':
    'Suche offener Posten im Formular der Buchung: wählt einen Wert (Spec § 3, „Nicht in FilterBar“), ist aber noch kein Kombobox-Baustein mit Lupe und ✕ — offen, Bericht Plan Lb.',
};
const TABLIST_ALLOWED: Allowlist = {};
const URL_FILTERS_WITHOUT_BAR: Allowlist = {};

const appFiles = () => sourceFiles(APP).filter((file) => file.endsWith('.tsx'));

describe('Filterleisten', () => {
  describe('Heuristiken', () => {
    it('erkennt ein rohes Suchfeld, aber kein anderes Feld mit Platzhalter', () => {
      expect(rawSearchInputs(`<Input type="search" value={q} />`)).toEqual([1]);
      expect(rawSearchInputs(`<Input\n  placeholder={t('searchPlaceholder')}\n/>`)).toEqual([1]);
      expect(rawSearchInputs(`<Input aria-label={ts('search')} />`)).toEqual([1]);
      expect(rawSearchInputs(`<Input placeholder={t('placePlaceholder')} />`)).toEqual([]);
      expect(rawSearchInputs(`<SearchField placeholder={t('searchPlaceholder')} />`)).toEqual([]);
    });

    it('erkennt Reiter aus Links, nicht Reiter aus Knöpfen', () => {
      expect(linkTablists(`<div role="tablist">\n<Link href="/a">A</Link>\n</div>`)).toEqual([1]);
      expect(linkTablists(`<div role="tablist"><button role="tab">A</button></div>`)).toEqual([]);
    });
  });

  it('unter src/app kein Suchfeld außerhalb von SearchField', () => {
    const hits = appFiles().flatMap((file) => rawSearchInputs(read(file)).map((line) => ({ file: relative(file), where: `${relative(file)}:${line}` })));
    expect(hits.filter(({ file }) => !(file in RAW_SEARCH_ALLOWED)).map(({ where }) => where)).toEqual([]);
  });

  it('kein role="tablist" an Links — Reiter über Listen sind ViewTabs', () => {
    const hits = appFiles().flatMap((file) => linkTablists(read(file)).map((line) => ({ file: relative(file), where: `${relative(file)}:${line}` })));
    expect(hits.filter(({ file }) => !(file in TABLIST_ALLOWED)).map(({ where }) => where)).toEqual([]);
  });

  it('wer Filter in der Adresse hält (useUrlFilters), rendert FilterBar', () => {
    const missing = appFiles().filter((file) => usesUrlFilters(read(file)) && !inFileOrLocalImport(file, /<FilterBar\b/)).map(relative);
    expect(missing.filter((file) => !(file in URL_FILTERS_WITHOUT_BAR))).toEqual([]);
  });

  it('jede Ausnahme ist noch nötig', () => {
    const stale = [
      ...Object.keys(RAW_SEARCH_ALLOWED).filter((file) => rawSearchInputs(read(path.join(SRC, file))).length === 0),
      ...Object.keys(TABLIST_ALLOWED).filter((file) => linkTablists(read(path.join(SRC, file))).length === 0),
      ...Object.keys(URL_FILTERS_WITHOUT_BAR).filter((file) => inFileOrLocalImport(path.join(SRC, file), /<FilterBar\b/)),
    ];
    expect(stale).toEqual([]);
  });
});
