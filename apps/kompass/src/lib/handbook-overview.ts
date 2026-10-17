import type { HandbookChapter } from '@kompass/core';

/**
 * Die Übersicht `/help` gruppiert anders als das Verzeichnis neben einer Seite (Runde 3, 009): In Spalten wirkten
 * Einzelseiten („Startseite“, „Profil“) wie Überschriften und rissen Löcher ins Raster. Eine Einzelseite, deren
 * Dokument eine Gruppe fortsetzt (`tiere-vorschlaege` nach `tiere`), wird zur Gruppe mit ihr; die übrigen stehen
 * zusammen unter `otherTitle` am Ende. `inhalt.md` und das Verzeichnis neben der Seite bleiben, wie sie sind.
 */
export function overviewChapters(chapters: readonly HandbookChapter[], otherTitle: string): HandbookChapter[] {
  const isSingle = (c: HandbookChapter) => c.pages.length === 1 && c.pages[0]!.title === c.title;
  const groups: HandbookChapter[] = [];
  const singles: HandbookChapter[] = [];
  for (const chapter of chapters) {
    if (!isSingle(chapter)) {
      groups.push({ title: chapter.title, pages: [...chapter.pages] });
      continue;
    }
    const doc = chapter.pages[0]!.doc;
    const parent = [...groups, ...singles].find((c) => c.pages.some((p) => doc.startsWith(`${p.doc}-`)));
    if (parent) {
      parent.pages.push(chapter.pages[0]!);
      // Aus einer Einzelseite mit Fortsetzung wird eine Gruppe.
      const at = singles.indexOf(parent);
      if (at !== -1) {
        singles.splice(at, 1);
        groups.splice(groups.length, 0, parent);
      }
      continue;
    }
    singles.push({ title: chapter.title, pages: [...chapter.pages] });
  }
  // Gruppen in der Reihenfolge von `inhalt.md`: die gebildete Gruppe steht dort, wo ihre erste Seite stand.
  const order = (c: HandbookChapter) => chapters.findIndex((x) => x.pages.some((p) => p.doc === c.pages[0]!.doc));
  groups.sort((a, b) => order(a) - order(b));
  return singles.length > 0 ? [...groups, { title: otherTitle, pages: singles.flatMap((c) => c.pages) }] : groups;
}
