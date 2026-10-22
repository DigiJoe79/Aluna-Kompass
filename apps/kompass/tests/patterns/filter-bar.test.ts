import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Allowlist, allowlistHygiene, inFileOrLocalImport, openingTags, read, relative, sourceFiles, SRC, staleKeys } from './source';

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

export const RAW_SEARCH_ALLOWED: Allowlist = {
  'app/(shell)/finance/entries/entry-form.tsx':
    'Suche offener Posten im Formular der Buchung: wählt einen Wert (Spec § 3, „Nicht in FilterBar“), ist aber noch kein Kombobox-Baustein mit Lupe und ✕ — offen, Bericht Plan Lb.',
};
export const TABLIST_ALLOWED: Allowlist = {};
export const URL_FILTERS_WITHOUT_BAR: Allowlist = {};

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

  const search = appFiles().flatMap((file) => rawSearchInputs(read(file)).map((line) => ({ file: relative(file), where: `${relative(file)}:${line}` })));
  const tablists = appFiles().flatMap((file) => linkTablists(read(file)).map((line) => ({ file: relative(file), where: `${relative(file)}:${line}` })));
  const withoutBar = appFiles().filter((file) => usesUrlFilters(read(file)) && !inFileOrLocalImport(file, /<FilterBar\b/)).map(relative);

  it('unter src/app kein Suchfeld außerhalb von SearchField', () => {
    expect(search.filter(({ file }) => !(file in RAW_SEARCH_ALLOWED)).map(({ where }) => where)).toEqual([]);
  });

  allowlistHygiene(RAW_SEARCH_ALLOWED, () => staleKeys(RAW_SEARCH_ALLOWED, search.map(({ file }) => file)), 'Suchfelder');

  it('kein role="tablist" an Links — Reiter über Listen sind ViewTabs', () => {
    expect(tablists.filter(({ file }) => !(file in TABLIST_ALLOWED)).map(({ where }) => where)).toEqual([]);
  });

  allowlistHygiene(TABLIST_ALLOWED, () => staleKeys(TABLIST_ALLOWED, tablists.map(({ file }) => file)), 'Reiter');

  it('wer Filter in der Adresse hält (useUrlFilters), rendert FilterBar', () => {
    expect(withoutBar.filter((file) => !(file in URL_FILTERS_WITHOUT_BAR))).toEqual([]);
  });

  allowlistHygiene(URL_FILTERS_WITHOUT_BAR, () => staleKeys(URL_FILTERS_WITHOUT_BAR, withoutBar), 'Filter ohne Leiste');
});
