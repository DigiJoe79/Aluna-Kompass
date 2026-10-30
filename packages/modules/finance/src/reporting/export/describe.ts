import { csvDocument, paperDate } from '@kompass/core';
import { GDPDU_DTD_FILE } from './gdpdu-dtd';
import { zonedDayOf } from '../../zoned-days';
import type { ExportColumn, ExportScope, ExportTable } from './tables';

/**
 * Die Beschreibung der Dateien: `index.xml` nach dem GDPdU-Beschreibungsstandard (DTD `gdpdu-01-09-2004.dtd`, liegt
 * bei), `feldbeschreibung.csv` für Menschen und `LIESMICH.txt`. Alles aus `EXPORT_TABLES`, damit Beschreibung und
 * Dateien nie auseinanderlaufen. Deutsch wie die Dateien selbst (Dokument des Vereins).
 */

const xml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Ein Tag oder Zeitstempel als Tag auf Papier, Zeitstempel in der Zone des Vereins (F-B3). */
const day = (value: string, scope: ExportScope) => paperDate(zonedDayOf(value, scope.timeZone) as never);

const TYPE_LABEL: Record<ExportColumn['type'], string> = { text: 'Text', amount: 'Betrag', day: 'Datum', timestamp: 'Zeitpunkt', bool: 'Schalter', integer: 'Zahl' };

/** Je Spalte die Art nach der DTD: `(Numeric | (AlphaNumeric, MaxLength?) | Date)`. */
function columnType(c: ExportColumn): string {
  switch (c.type) {
    case 'amount': return '<Numeric><Accuracy>2</Accuracy></Numeric>';
    case 'integer': return '<Numeric/>';
    case 'day': return '<Date><Format>DD.MM.YYYY</Format></Date>';
    default: return '<AlphaNumeric/>';
  }
}

/** Erster und letzter Tag der gewählten Jahre. */
function period(scope: ExportScope): { from: string; to: string } {
  const starts = scope.fiscalYears.map((y) => y.startsOn).sort();
  const ends = scope.fiscalYears.map((y) => y.endsOn).sort();
  return { from: starts[0]!, to: ends.at(-1)! };
}

export const designationsOf = (scope: ExportScope, open?: boolean) =>
  [...scope.fiscalYears].filter((y) => open === undefined || y.open === open).sort((a, b) => a.startsOn.localeCompare(b.startsOn)).map((y) => y.designation).join(', ');

/**
 * `index.xml`: Reihenfolge der Elemente nach der DTD — `DataSet (Version, DataSupplier, Media)`, `DataSupplier (Name,
 * Location, Comment)`, `Media (Name, Table*)`, `Table (URL, Name, Description, Validity, UTF8, DecimalSymbol,
 * DigitGroupingSymbol, Range, VariableLength)`, `VariableLength (ColumnDelimiter, RecordDelimiter, TextEncapsulator,
 * VariableColumn+)`, `VariableColumn (Name, Description, Typ)`. `Range From 2` überspringt die Kopfzeile.
 */
export function gdpduIndexXml(tables: readonly ExportTable[], meta: { supplier: string; location: string; createdAt: string; scope: ExportScope }): string {
  const { from, to } = period(meta.scope);
  const provisional = designationsOf(meta.scope, true);
  const comment = `Datenexport nach § 147 Abs. 6 AO, erzeugt am ${day(meta.createdAt, meta.scope)}, Geschäftsjahre ${designationsOf(meta.scope)}${provisional ? `; vorläufig: ${provisional}` : ''}`;
  const table = (t: ExportTable) =>
    [
      '    <Table>',
      `      <URL>${xml(t.file)}</URL>`,
      `      <Name>${xml(t.title)}</Name>`,
      `      <Description>${xml(t.description)}</Description>`,
      `      <Validity><Range><From>${day(from, meta.scope)}</From><To>${day(to, meta.scope)}</To></Range><Format>DD.MM.YYYY</Format></Validity>`,
      '      <UTF8/>',
      '      <DecimalSymbol>,</DecimalSymbol>',
      '      <DigitGroupingSymbol>.</DigitGroupingSymbol>',
      '      <Range><From>2</From></Range>',
      '      <VariableLength>',
      '        <ColumnDelimiter>;</ColumnDelimiter>',
      '        <RecordDelimiter>&#13;&#10;</RecordDelimiter>',
      '        <TextEncapsulator>&quot;</TextEncapsulator>',
      ...t.columns.map((c) => `        <VariableColumn><Name>${xml(c.name)}</Name><Description>${xml(`${c.label}: ${c.description}`)}</Description>${columnType(c)}</VariableColumn>`),
      '      </VariableLength>',
      '    </Table>',
    ].join('\r\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<!DOCTYPE DataSet SYSTEM "${GDPDU_DTD_FILE}">`,
    '<DataSet>',
    '  <Version>1.0</Version>',
    `  <DataSupplier><Name>${xml(meta.supplier)}</Name><Location>${xml(meta.location)}</Location><Comment>${xml(comment)}</Comment></DataSupplier>`,
    '  <Media>',
    `    <Name>${xml(`Datenexport ${designationsOf(meta.scope)}`)}</Name>`,
    ...tables.map(table),
    '  </Media>',
    '</DataSet>',
    '',
  ].join('\r\n');
}

/** Eine Zeile je Spalte jeder Datei. */
export function fieldDescriptionCsv(tables: readonly ExportTable[]): string {
  return csvDocument(['Datei', 'Feld', 'Bezeichnung', 'Typ', 'Bedeutung'], tables.flatMap((t) => t.columns.map((c) => [t.file, c.name, c.label, TYPE_LABEL[c.type], c.description])));
}

/** `LIESMICH.txt`: was im ZIP steckt, welche Jahre vorläufig sind, wie die Dateien zu lesen sind. */
export function readmeText(meta: { createdAt: string; scope: ExportScope }, tables: readonly ExportTable[]): string {
  const provisional = designationsOf(meta.scope, true);
  const closed = designationsOf(meta.scope, false);
  const lines = [
    'Datenexport für eine Außenprüfung (§ 147 Abs. 6 AO)',
    '',
    `Erzeugt am ${day(meta.createdAt, meta.scope)} mit Kompass.`,
    closed ? `Abgeschlossene Geschäftsjahre: ${closed}.` : null,
    provisional ? `Vorläufig (Geschäftsjahr noch offen, Buchungen können noch hinzukommen): ${provisional}.` : null,
    '',
    'Enthalten sind nur festgeschriebene Buchungen. Die Belege selbst stecken nicht in diesem Export, sondern im Prüfpaket der Kassenprüfung; belege.csv nennt Nummer und Prüfsumme (SHA-256) jedes Belegs.',
    '',
    'Dateien:',
    ...tables.map((t) => `- ${t.file}: ${t.description}`),
    '- feldbeschreibung.csv: Bedeutung jeder Spalte',
    `- index.xml: Beschreibung nach dem GDPdU-Beschreibungsstandard für die Prüfsoftware der Finanzverwaltung, mit der DTD ${GDPDU_DTD_FILE}`,
    '',
    'Format: UTF-8 mit BOM, Semikolon als Trennzeichen, Zeilenende CRLF, Kopfzeile mit Feldnamen. Beträge in Euro mit Dezimalkomma ohne Tausenderpunkt (-1234,56), Tage als TT.MM.JJJJ, Zeitpunkte als ISO 8601 in UTC, Schalter als ja/nein. Ein Textfeld, das mit = + - @ beginnt, trägt ein vorangestelltes Hochkomma, damit eine Tabellenkalkulation es nicht als Formel ausführt.',
    '',
    `DTD ${GDPDU_DTD_FILE}: GDPdU-Beschreibungsstandard, Urheber Audicon GmbH (heute Caseware), unverändert aus der Dateisammlung DSFinV-K 2.4 des Bundeszentralamts für Steuern (bzst.de).`,
    '',
  ];
  return lines.filter((l) => l !== null).join('\r\n');
}
