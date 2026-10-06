import { describe, expect, it } from 'vitest';
import { type Allowlist, matchingLines, read, relative, sourceFiles } from './source';

/**
 * Formulare rastern über `FormGrid` und `FormField size` (docs/MUSTER.md § J, Handoff Konsistenz § 8b): vier
 * Spalten nach Kartenbreite statt `md:grid-cols-2` und `grid-cols-[1fr_2fr]` von Hand. Bei 1200 px Seitenbreite
 * wurde im alten Zwei-Spalten-Raster jedes Feld ~570 px breit, die PLZ wie der Vereinsname. Geprüft werden
 * Dateien, die `FormField` verwenden.
 */
// Zwei Gruppen von Ausnahmen (Plan K8/K9 T6), damit sichtbar bleibt, welche aus welchem Grund besteht. Eine neue
// kommt mit Grund in die passende Gruppe; passt sie in keine, ist sie vermutlich keine Ausnahme.
const ALLOWED: Allowlist = {
  // — Werkzeug-Layout: Arbeitsflächen und Zeilen-Editoren mit eigenem Raster; ihre Felder stehen trotzdem im FormGrid.
  'app/(shell)/admin/roles/role-editor.tsx':
    'Werkzeug-Layout: Rollenliste neben dem Detail und die Rechte-Matrix als Tabellenraster; die Felder im Detailkopf stehen im FormGrid (Inventar § 3 A).',
  'app/(shell)/admin/themes/theme-editor.tsx':
    'Werkzeug-Layout: Liste, Farbtabelle und Vorschau nebeneinander, kein Formularraster abbildbar; der Dialog steht im FormGrid (Inventar § 3 A).',
  'app/(shell)/animals/animal-form.tsx':
    'Prüfansicht Texte neben Fotos: eigenes Zwei-Block-Layout nur im Reiter „Texte und Fotos“, jeder Block mit eigenem FormGrid (Plan K8/K9 T2b).',
  'app/(shell)/projects/external-links-field.tsx':
    'Zeilen-Editor mit eigenem Zeilenraster (Bezeichnung · Adresse · Entfernen je Verweis); der Editor steht als Ganzes `full` im FormGrid (Inventar § 3 B).',
  'app/(shell)/finance/partners/[id]/payments/[paymentId]/draft-form.tsx':
    'Positionszeile mit eigenem Zeilenraster (Betrag · Kategorie · bezahlt aus · Projekt je Position), wie `split-row`; die Felder der Zahlung stehen im FormGrid (Entscheidung zum Inventar § E).',
  'components/finance/split-row.tsx':
    'Zeilen-Editor mit eigenem Zeilenraster (Kategorie · Betrag · Umsatzsteuer · Empfänger · Projekt je Aufteilungszeile); nur die Schalter stehen als FormField toggle darin (Entscheidung zum Inventar § D).',
  'app/(shell)/finance/cash/count-dialog.tsx':
    'Zählhilfe mit eigenem Unterraster für die Stückelungen (`grid-cols-3`); die Felder des Dialogs stehen im FormGrid (Entscheidung zum Inventar § D).',
  // — Anzeige, kein Formular: Seitenlayout einer Lesesicht oder Definitionsliste neben bzw. in einem Formular.
  'app/(shell)/dms/[id]/document-detail.tsx':
    'Seitenlayout der Lesesicht: Dokumentvorschau neben der Angabenspalte (`lg:grid-cols-3`), kein Formular; der Storno-Dialog steht im FormGrid (Inventar § 3 C).',
  'app/(shell)/finance/approvals/approval-detail.tsx':
    'Seitenlayout der Freigabe: Positionen neben der Belegvorschau (`xl:grid-cols-[…]`), kein Formularraster; die Entscheidung je Position steht im FormGrid (Inventar § 3 D).',
  'app/(shell)/finance/partners/[id]/partner-detail.tsx':
    'Seitenlayout der Detailseite: Angaben zum Partner neben Bescheiden und Zahlungen (`lg:grid-cols-2`), kein Formularraster; die Felder der Abschnitte und das Bescheid-Formular stehen im FormGrid (Inventar § 3 E).',
  'app/(shell)/finance/donations/issue-dialog.tsx':
    'Dialoglayout: Voraussetzungen neben der Vorschau der Bestätigung (`lg:grid-cols-[minmax(0,1fr)_400px]`), kein Formularraster; die Angaben zur Sachspende stehen im FormGrid (Inventar § 3 D).',
  'app/(shell)/finance/donations/confirmations-table.tsx':
    'Aufklapp-Detail einer Tabellenzeile (`md:grid-cols-[2fr_1fr]`), Anzeige, kein Formular; Versand- und Rückholdialog stehen im FormGrid (Inventar § 3 D).',
  'app/(shell)/finance/imports/format/csv-assistant.tsx':
    'Probezeile als Definitionsliste (`grid-cols-[max-content_1fr]`), Anzeige, kein Formular; die Felder der Schritte stehen im FormGrid (Inventar § 3 D).',
};


const hits = () =>
  sourceFiles()
    .map((file) => ({ file, text: read(file) }))
    .filter(({ text }) => /<FormField\b/.test(text))
    .flatMap(({ file, text }) => matchingLines(file, text, /grid-cols-/).map((where) => ({ where, file: relative(file) })));

describe('Formularraster über FormGrid', () => {
  it('kein grid-cols-* in Dateien mit FormField', () => {
    expect(hits().filter(({ file }) => !(file in ALLOWED)).map(({ where }) => where)).toEqual([]);
  });

  // HANDOFF Konsistenz § 8c (Joe, 05.10.): Was im Raster kein Feld ist, steht in `FormCell size`; die Klassen der
  // Spannweite schreibt niemand von Hand, sonst laufen Feld und Nachbar bei der nächsten Rasteränderung auseinander.
  it('FIELD_SPAN nur in form-field.tsx und form-grid.tsx', () => {
    const own = new Set(['components/forms/form-field.tsx', 'components/forms/form-grid.tsx']);
    const found = sourceFiles()
      .filter((file) => !own.has(relative(file)))
      .flatMap((file) => matchingLines(file, read(file), /FIELD_SPAN/, { comments: true }));
    expect(found).toEqual([]);
  });

  it('jede Ausnahme ist noch nötig', () => {
    const using = new Set(hits().map(({ file }) => file));
    expect(Object.keys(ALLOWED).filter((file) => !using.has(file))).toEqual([]);
  });
});
