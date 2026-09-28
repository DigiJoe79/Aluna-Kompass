/**
 * CSV nach RFC 4180 in Datensätze zerlegen: Felder in `"…"`, `""` steht für
 * ein Anführungszeichen, Trennzeichen und Zeilenumbrüche in Anführungszeichen
 * gehören zum Feld. Ein Datensatz mit Umbruch im Feld bleibt **ein**
 * Datensatz — so zählen auch die Zeilenangaben der Fehlermeldungen (F4b).
 * Leere Datensätze am Ende fallen weg, leere dazwischen bleiben als `['']`.
 */
export function tokenizeCsv(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === '') {
      quoted = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      record.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  record.push(field);
  records.push(record);
  while (records.length > 0 && records[records.length - 1]!.length === 1 && records[records.length - 1]![0] === '') records.pop();
  return records;
}
