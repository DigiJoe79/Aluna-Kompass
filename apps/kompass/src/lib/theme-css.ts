import { DEFAULT_THEME, THEME_TOKENS, THEME_VALUE_PATTERN, type Theme } from '@kompass/core';

/**
 * Baut das `<style>` mit den Theme-Tokens für das Wurzel-Layout.
 *
 * Werte werden seit dem 2026-09-15 schon beim Schreiben geprüft
 * (`themeTokensSchema` im Kern, dasselbe Muster). Hier steht der zweite
 * Riegel für den einen Weg, der daran vorbeiführt: Ein Backup-Import ersetzt
 * die Datenbank als Datei, ohne ihren Inhalt zu prüfen.
 *
 * Ein unbrauchbarer Wert fällt auf den der mitgelieferten Vorgabe zurück,
 * statt einen Fehler zu werfen. Das ist keine Nachlässigkeit, sondern der
 * Unterschied zwischen einer Installation mit einer falschen Farbe und einer,
 * die gar nicht mehr aufgeht: Dieses `<style>` liegt auf **jeder** Seite —
 * ein Wurf nähme auch die Themes-Seite mit, über die man den Wert
 * zurücknehmen würde.
 */
function safeValue(token: (typeof THEME_TOKENS)[number], value: string, mode: 'light' | 'dark'): string {
  if (THEME_VALUE_PATTERN.test(value)) return value;
  // Ins Containerprotokoll, damit es nicht nur still richtig aussieht.
  console.warn(`[kompass] Theme-Wert für ${token} (${mode}) unbrauchbar, Vorgabe eingesetzt`);
  return DEFAULT_THEME.tokens[token][mode];
}

function block(selector: string, theme: Theme, mode: 'light' | 'dark'): string {
  const declarations = THEME_TOKENS.map((token) => `--${token}:${safeValue(token, theme.tokens[token][mode], mode)}`);
  return `${selector}{${declarations.join(';')}}`;
}

export function themeToCss(theme: Theme): string {
  return `${block(':root', theme, 'light')}\n${block(':root[data-color-scheme="dark"]', theme, 'dark')}`;
}
