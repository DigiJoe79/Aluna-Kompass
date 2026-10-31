import { describe, expect, it } from 'vitest';
import { allowlistHygiene, checkCountedAllowlist, type CountedAllowlist, type Hit, isProductSource, read, relative, sourceFiles, SRC } from './source';

/**
 * Masken nutzen `ActionForm` statt `<form action>` (AGENTS.md, Coding-Regeln): React 19 setzt ein `<form action>` nach
 * jedem Durchlauf zurück, auch nach einer Ablehnung — die Eingaben wären weg (Code-Review 0.4.0, App-B5: Notiz an einem
 * Dokument, Sprache hinzufügen). Die Regel stand ohne Wächter. Ausnahmen mit Grund: Anmeldung, Passwort, Einrichtung,
 * wo ein falsches Passwort ruhig verschwinden soll, und Formulare ohne Felder mit `defaultValue`. `FormCard as="form"`
 * rendert dasselbe `<form>`; die Regel gilt auch außerhalb von `src/app` (Nachlauf R3). Sie gilt auch für gesteuerte
 * Felder mit `<select>`: Ein natives Auswahlfeld springt beim Zurücksetzen auf die erste Option, React stellt es nicht
 * wieder her (Webseiten-Einträge und Variablen bis 0.5.1).
 */
const FORM_ACTION = /<form\b(?:[^>]|=>)*?\saction=/g;
const FORM_CARD = /<FormCard\b(?:[^>]|=>)*?>/g;

export function formActionHits(text: string, file: string): Hit[] {
  const cards = [...text.matchAll(FORM_CARD)].filter((m) => /\sas="form"/.test(m[0]) && /\saction=/.test(m[0]));
  return [...text.matchAll(FORM_ACTION), ...cards].map((m) => ({ where: `${file}:${text.slice(0, m.index).split('\n').length}`, file }));
}

/** Pfade relativ zu `src/`. */
export const ALLOWED: CountedAllowlist = {
  'app/login/login-form.tsx': { count: 1, reason: 'Anmeldung: Ein falsches Passwort soll nach der Ablehnung verschwinden (AGENTS.md).' },
  'app/(shell)/profile/password-form.tsx': { count: 1, reason: 'Passwort ändern: Die Passwörter sollen nach dem Absenden verschwinden, auch nach einer Ablehnung (AGENTS.md).' },
  'components/forms/action-form.tsx': { count: 1, reason: 'Kein Formular: Der Kommentar des Bausteins erklärt, warum es ihn statt `<form action>` gibt.' },
  'components/shell/user-menu.tsx': { count: 1, reason: 'Abmelden: Knopf ohne Felder, posted an `/logout`, ein Pfad statt einer Server Action.' },
  'app/password/password-form.tsx': { count: 1, reason: 'Passwort setzen: Passwortfelder sollen nach einer Ablehnung leer sein (AGENTS.md).' },
  'app/setup/setup-form.tsx': { count: 1, reason: 'Einrichtung mit Passwort (AGENTS.md).' },
  'app/setup/import/import-form.tsx': { count: 1, reason: 'Einrichtung aus einem Backup: nur ein verstecktes Feld, nichts Getipptes, das verloren ginge.' },
  'app/(shell)/dms/new/draft-form.tsx': { count: 1, reason: 'Alle Felder gesteuert (`value`, Kommentar dort), das Zurücksetzen nach einer Ablehnung trifft keine Eingabe.' },
  'app/(shell)/finance/audit/report-section.tsx': { count: 1, reason: '„Prüfbericht schreiben“: Formular ohne Felder, nur der Knopf; `<form action>` hält die Weiterleitung der Server Action.' },
};

describe('Heuristik', () => {
  it('trifft <form action>, auch über mehrere Zeilen und hinter Pfeilfunktionen', () => {
    for (const hit of ['<form action={action} className="x">', '<form\n  ref={formRef}\n  action={submit}\n>', '<form onKeyDown={(e) => e.key} action={a}>', '<FormCard as="form" action={action}>', '<FormCard\n  action={action}\n  as="form"\n>'])
      expect(formActionHits(hit, 'x'), hit).toHaveLength(1);
  });
  it('trifft nicht ActionForm, onSubmit und formAction an einem Knopf', () => {
    for (const miss of ['<ActionForm action={action} state={state}>', '<form onSubmit={(e) => save(e)}>', '<Button formAction={x}>', '<form className="x">\n<Button formAction={a} />', '<FormCard as="section">', '<FormCard as="form" onSubmit={(e) => save(e)}>'])
      expect(formActionHits(miss, 'x'), miss).toHaveLength(0);
  });
});

describe('ActionForm statt <form action>', () => {
  const files = sourceFiles(SRC).filter((file) => isProductSource(file) && file.endsWith('.tsx'));
  const hits = files.flatMap((file) => formActionHits(read(file), relative(file)));

  it('kein <form action> und kein FormCard als Formular mit action; Ausnahmen mit Grund', () => {
    expect(checkCountedAllowlist(hits, ALLOWED).unexpected).toEqual([]);
  });

  allowlistHygiene(ALLOWED, () => checkCountedAllowlist(hits, ALLOWED).stale);
});
