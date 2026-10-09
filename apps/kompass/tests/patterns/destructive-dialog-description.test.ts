import path from 'node:path';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openingTags, read, relative, sourceFiles, SRC, type Allowlist } from './source';

/**
 * Ein Dialog, der etwas Unumkehrbares tut, sagt die Folge in seiner Beschreibung (Spec Seitenkopf § 3.7, docs/MUSTER.md
 * § A „Beschreibung eines Dialogs“): Nur was in `DialogDescription` steht, liest ein Vorleser beim Öffnen vor.
 *
 * Geprüft wird **je Datei**, nicht je Block, weil der Hauptknopf oft in einer Unterkomponente derselben Datei steckt
 * (`void-dialog`: `VoidForm`). Eine Datei mit `<DialogContent` und einem Signal — `destructive` an einer
 * `FormActionBar`, `<Button variant="destructive"`, `role="alertdialog"` an `DialogContent` — braucht
 * `<DialogDescription`. `ConfirmDialog` zählt nicht: Dort ist `description` im Typ Pflicht, bei `refusal` ist die
 * Begründung die Beschreibung.
 */
const ALLOWED: Allowlist = {
};

export function needsDescription(text: string): boolean {
  if (!text.includes('<DialogContent')) return false;
  const signal =
    openingTags(text, /FormActionBar/).some(({ tag }) => /\bdestructive\b/.test(tag)) ||
    openingTags(text, /Button/).some(({ tag }) => /\bvariant="destructive"/.test(tag)) ||
    openingTags(text, /DialogContent/).some(({ tag }) => /\brole="alertdialog"/.test(tag));
  return signal && !text.includes('<DialogDescription');
}

const roots = ['app', 'components'].map((dir) => path.join(SRC, dir));

describe('Löschdialog mit Beschreibung', () => {
  it('jeder Dialog mit unumkehrbarer Hauptaktion hat eine DialogDescription', () => {
    const violations = roots.flatMap((root) => sourceFiles(root)).filter((file) => needsDescription(read(file))).map(relative);
    expect(violations.filter((file) => !(file in ALLOWED))).toEqual([]);
  });

  it('jede Ausnahme ist noch nötig', () => {
    const stale = Object.keys(ALLOWED).filter((file) => !existsSync(path.join(SRC, file)) || !needsDescription(read(path.join(SRC, file))));
    expect(stale).toEqual([]);
  });

  it('Heuristik: je Signal ein Treffer ohne Beschreibung', () => {
    expect(needsDescription('<DialogContent size="sm"><FormActionBar placement="dialog" destructive /></DialogContent>')).toBe(true);
    expect(needsDescription('<DialogContent size="sm"><Button variant="destructive">Weg</Button></DialogContent>')).toBe(true);
    expect(needsDescription('<DialogContent role="alertdialog" size="sm"><Button>OK</Button></DialogContent>')).toBe(true);
  });

  it('Heuristik: kein Treffer mit Beschreibung, nur mit ConfirmDialog oder ohne DialogContent', () => {
    expect(needsDescription('<DialogContent size="sm"><DialogDescription tone="body">Folge.</DialogDescription><FormActionBar placement="dialog" destructive /></DialogContent>')).toBe(false);
    expect(needsDescription('<ConfirmDialog destructive description="Folge." />')).toBe(false);
    expect(needsDescription('<Button variant="destructive">Weg</Button>')).toBe(false);
  });
});
