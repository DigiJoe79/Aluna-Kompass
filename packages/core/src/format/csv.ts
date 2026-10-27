/**
 * CSV wie ein deutsches Excel sie ohne Importdialog öffnet: UTF-8 mit BOM, Semikolon, CRLF. Eine Stelle für
 * Aktenexport (Inhaltsverzeichnis) und Datenexport der Finanzen, damit beide dieselbe Formel-Sperre haben.
 */
export function csvField(value: string | null, { formulaGuard = true }: { formulaGuard?: boolean } = {}): string {
  if (value === null || value === '') return '';
  // Fremder Text (Eingangspost, Verwendungszweck): Was mit = + - @ beginnt, führte eine Tabellenkalkulation als Formel aus.
  // Zahlen und Tage aus Kompass selbst brauchen die Sperre nicht; ein negativer Betrag bliebe sonst Text (`formulaGuard: false`).
  const safe = formulaGuard && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[;"\r\n']/.test(safe) || safe !== value ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Kopfzeile und Zeilen als ein Text; auch die letzte Zeile endet mit CRLF. */
export function csvDocument(header: readonly string[], rows: Iterable<readonly (string | null)[]>): string {
  const lines = [header.map((h) => csvField(h)).join(';')];
  for (const row of rows) lines.push(row.map((v) => csvField(v)).join(';'));
  return `﻿${lines.join('\r\n')}\r\n`;
}
