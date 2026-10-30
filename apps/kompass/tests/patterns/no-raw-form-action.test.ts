import { describe, expect, it } from 'vitest';
import { allowlistHygiene, checkCountedAllowlist, type CountedAllowlist, type Hit, isProductSource, read, relative, sourceFiles, SRC } from './source';

/**
 * Masken nutzen `ActionForm` statt `<form action>` (AGENTS.md, Coding-Regeln): React 19 setzt ein `<form action>` nach
 * jedem Durchlauf zurück, auch nach einer Ablehnung — die Eingaben wären weg (Code-Review 0.4.0, App-B5: Notiz an einem
 * Dokument, Sprache hinzufügen). Die Regel stand ohne Wächter. Ausnahmen mit Grund: Anmeldung, Passwort, Einrichtung,
 * wo ein falsches Passwort ruhig verschwinden soll, und Formulare ohne Felder mit `defaultValue`.
 */
const FORM_ACTION = /<form\b(?:[^>]|=>)*?\saction=/g;

export function formActionHits(text: string, file: string): Hit[] {
  return [...text.matchAll(FORM_ACTION)].map((m) => ({ where: `${file}:${text.slice(0, m.index).split('\n').length}`, file }));
}

/** Pfade relativ zu `src/`. */
export const ALLOWED: CountedAllowlist = {
  'app/login/login-form.tsx': { count: 1, reason: 'Anmeldung: Ein falsches Passwort soll nach der Ablehnung verschwinden (AGENTS.md).' },
  'app/password/password-form.tsx': { count: 1, reason: 'Passwort setzen: Passwortfelder sollen nach einer Ablehnung leer sein (AGENTS.md).' },
  'app/setup/setup-form.tsx': { count: 1, reason: 'Einrichtung mit Passwort (AGENTS.md).' },
  'app/setup/import/import-form.tsx': { count: 1, reason: 'Einrichtung aus einem Backup: nur ein verstecktes Feld, nichts Getipptes, das verloren ginge.' },
  'app/(shell)/dms/new/draft-form.tsx': { count: 1, reason: 'Alle Felder gesteuert (`value`, Kommentar dort), das Zurücksetzen nach einer Ablehnung trifft keine Eingabe.' },
  'app/(shell)/finance/audit/report-section.tsx': { count: 1, reason: '„Prüfbericht schreiben“: Formular ohne Felder, nur der Knopf; `<form action>` hält die Weiterleitung der Server Action.' },
};

describe('Heuristik', () => {
  it('trifft <form action>, auch über mehrere Zeilen und hinter Pfeilfunktionen', () => {
    for (const hit of ['<form action={action} className="x">', '<form\n  ref={formRef}\n  action={submit}\n>', '<form onKeyDown={(e) => e.key} action={a}>'])
      expect(formActionHits(hit, 'x'), hit).toHaveLength(1);
  });
  it('trifft nicht ActionForm, onSubmit und formAction an einem Knopf', () => {
    for (const miss of ['<ActionForm action={action} state={state}>', '<form onSubmit={(e) => save(e)}>', '<Button formAction={x}>', '<form className="x">\n<Button formAction={a} />'])
      expect(formActionHits(miss, 'x'), miss).toHaveLength(0);
  });
});

describe('ActionForm statt <form action>', () => {
  const files = sourceFiles(`${SRC}/app`).filter((file) => isProductSource(file) && file.endsWith('.tsx'));
  const hits = files.flatMap((file) => formActionHits(read(file), relative(file)));

  it('kein <form action> unter src/app; Ausnahmen mit Grund', () => {
    expect(checkCountedAllowlist(hits, ALLOWED).unexpected).toEqual([]);
  });

  allowlistHygiene(ALLOWED, () => checkCountedAllowlist(hits, ALLOWED).stale);
});
