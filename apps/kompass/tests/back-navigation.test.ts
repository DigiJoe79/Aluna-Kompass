import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Wer eine Seite über die Navigation erreicht, kommt über die Navigation auch
 * wieder weg. Wer sie über eine Zeile, einen Knopf oder einen Link erreicht
 * hat, nicht: Für ihn ist der einzige Ausgang die Zurück-Taste des Browsers —
 * und die verwirft in einem Formular kommentarlos alles Getippte.
 *
 * Solche Seiten tragen deshalb `back` am `PageHeader`. Geprüft wird jede Seite
 * unterhalb der ersten Ebene eines Bereichs; was über die Navigation erreichbar
 * ist, steht unten mit Begründung.
 */
const ROOT = path.resolve(import.meta.dirname, '../src/app/(shell)');

/** Seiten ohne Rückweg — jede mit dem Grund, warum sie keinen braucht. */
const NO_BACK_NEEDED = new Set([
  // Sammlungen des Templates stehen als eigene Einträge in der Navigation.
  'site/c/[collection]',
  // Fängt unbekannte Pfade ab und zeigt selbst die Wege an.
  '[...catchAll]',
  // Zeigt die Akte mit dem Ablegen-Dialog darüber: Der Ausgang ist das
  // Schliessen des Dialogs, dahinter steht die Liste schon.
  'dms/receive',
]);

/**
 * Navigationsziele sind feste Pfade. Einen Rückweg braucht daher, was einen
 * Platzhalter trägt — also aus einer Zeile heraus geöffnet wurde — oder was
 * eine Handlung an einem Bereich ist.
 */
const ACTION_SEGMENTS = ['new', 'receive', 'edit'];
const needsBack = (route: string) =>
  route.includes('[') || ACTION_SEGMENTS.includes(route.split('/').at(-1) ?? '');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Die Route einer Seite, relativ zu `(shell)`, ohne `/page.tsx`. */
const routeOf = (file: string) => path.dirname(path.relative(ROOT, file));

describe('Seiten abseits der Navigation', () => {
  it('bieten einen Rückweg an', () => {
    const missing = walk(ROOT)
      .filter((file) => path.basename(file) === 'page.tsx')
      .map((file) => ({ route: routeOf(file).split(path.sep).join('/'), file }))
      .filter(({ route }) => needsBack(route))
      .filter(({ route }) => !NO_BACK_NEEDED.has(route))
      .filter(({ file }) => !readFileSync(file, 'utf8').includes('back={'))
      .map(({ route }) => route);

    expect(missing).toEqual([]);
  });
});
