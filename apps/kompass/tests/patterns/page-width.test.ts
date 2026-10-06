import { describe, expect, it } from 'vitest';
import { type Allowlist, read, relative, sourceFiles, SRC } from './source';
import path from 'node:path';

/**
 * Jede Seite der Schale wählt eine der drei Breiten über `<Page width>` (docs/MUSTER.md § I, Handoff Konsistenz
 * § 8a): `task` 720, `standard` 1200, `full`. Bis 0.2.6 gab es zehn Seitenbreiten, und Tier, Projekt, Kontakt
 * und Buchung wurden auf großen Schirmen überbreit. Geprüft wird jede `page.tsx` unter `app/(shell)` und die
 * Fehlerseiten der Schale.
 */
const ALLOWED: Allowlist = {
  'app/(shell)/finance/page.tsx': 'Weiterleitung auf den ersten Finanzbereich, rendert nichts.',
  'app/(shell)/site/template/page.tsx': 'Weiterleitung (`redirect`), rendert nichts.',
  'app/(shell)/[...catchAll]/page.tsx': 'Ruft nur `notFound()`; die Seite dazu ist `not-found.tsx`.',
  'app/(shell)/site/preview-frame/page.tsx': 'Inhalt eines iframes der Vorschau, keine Seite der Schale.',
};


const SHELL = path.join(SRC, 'app/(shell)');
const pages = () =>
  sourceFiles(SHELL).filter((file) => /\/(page|error|not-found)\.tsx$/.test(file)).map((file) => ({ file: relative(file), text: read(file) }));

describe('Seitenbreite über Page', () => {
  it('jede Seite rendert <Page width=…>', () => {
    const violations = pages().filter(({ file, text }) => !/<Page\s+width=/.test(text) && !(file in ALLOWED));
    expect(violations.map(({ file }) => file)).toEqual([]);
  });

  it('jede Ausnahme ist noch nötig', () => {
    const without = new Set(pages().filter(({ text }) => !/<Page\s+width=/.test(text)).map(({ file }) => file));
    expect(Object.keys(ALLOWED).filter((file) => !without.has(file))).toEqual([]);
  });
});
