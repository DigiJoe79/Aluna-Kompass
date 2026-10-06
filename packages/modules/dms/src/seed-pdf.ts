/**
 * Einseitige PDFs mit Textebene, erzeugt ohne Werkzeug — für die
 * Entwicklungsdaten der Akte und der Module. Der Worker liest sie wie ein
 * echtes digitales Schreiben, die Volltextsuche findet ihren Inhalt.
 *
 * Bewusst von Hand statt über Typst: Der Seed läuft auch in Unit-Tests und im
 * E2E-Reset, wo es kein Typst geben muss, und eine Binärdatei im Paket hätte
 * einen eigenen Weg ins gebündelte Image gebraucht.
 */

/** Helvetica und Courier mit WinAnsi kennen ä, ö, ü und ß als einzelne Bytes (Latin-1). */
function latin1(text: string): Uint8Array {
  return Uint8Array.from(text, (ch) => {
    const code = ch.charCodeAt(0);
    if (code > 0xff) throw new Error(`Zeichen ausserhalb von Latin-1: ${ch}`);
    return code;
  });
}

const escape = (line: string) => line.replace(/[\\()]/g, (c) => `\\${c}`);

interface PageLayout {
  width: number;
  height: number;
  font: 'Helvetica' | 'Courier';
  size: number;
  leading: number;
  left: number;
  top: number;
}

const A4_LETTER: PageLayout = { width: 595, height: 842, font: 'Helvetica', size: 11, leading: 14, left: 72, top: 770 };

function pdfPage(layout: PageLayout, lines: readonly string[]): Uint8Array {
  const { width, height, font, size, leading, left, top } = layout;
  const content = ['BT', `/F1 ${size} Tf`, `${leading} TL`, `${left} ${top} Td`, ...lines.map((line) => `(${escape(line)}) Tj T*`), 'ET'].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /${font} /Encoding /WinAnsiEncoding >>`,
    `<< /Length ${latin1(content).length} >>\nstream\n${content}\nendstream`,
  ];

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(latin1(body).length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefAt = latin1(body).length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return latin1(body);
}

export function textPdf(lines: readonly string[]): Uint8Array {
  return pdfPage(A4_LETTER, lines);
}

/** Ein erfundener Kassenbon: Laden, Positionen, Summe — kein echter Laden, keine echte Marke. */
export interface SeedReceipt {
  shop: readonly string[];
  /** ISO-Datum `YYYY-MM-DD`, gedruckt als TT.MM.JJJJ. */
  date: string;
  time: string;
  /** `vat` 7 für ermäßigte Ware (Futter, Stroh), gedruckt als „B“; Vorgabe 19, „A“. */
  items: readonly { text: string; cents: number; vat?: 7 | 19 }[];
  payment: 'BAR' | 'EC-KARTE';
  receiptNo: string;
}

/** Zeichen je Zeile auf dem Bon: 80-mm-Rolle, Courier 9 pt. */
const RECEIPT_COLUMNS = 34;

const euro = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');
const germanDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const center = (text: string) => text.padStart(Math.floor((RECEIPT_COLUMNS + text.length) / 2)).padEnd(RECEIPT_COLUMNS);
const row = (left: string, right: string) => `${left.slice(0, RECEIPT_COLUMNS - right.length - 1).padEnd(RECEIPT_COLUMNS - right.length)}${right}`;

/** Die Zeilen des Bons — eigene Funktion, damit ein Test sie ohne PDF-Leser prüfen kann. */
export function receiptLines(r: SeedReceipt): string[] {
  const rule = '-'.repeat(RECEIPT_COLUMNS);
  const total = r.items.reduce((sum, item) => sum + item.cents, 0);
  const RATES = [
    { rate: 19, letter: 'A' },
    { rate: 7, letter: 'B' },
  ] as const;
  const letter = (vat: 7 | 19 = 19) => (vat === 7 ? 'B' : 'A');
  const vatLines = RATES.flatMap(({ rate, letter: l }) => {
    const gross = r.items.filter((item) => (item.vat ?? 19) === rate).reduce((sum, item) => sum + item.cents, 0);
    return gross === 0 ? [] : [row(`${l} ${rate} % MwSt. enthalten`, euro(Math.round((gross * rate) / (100 + rate))))];
  });
  return [
    ...r.shop.map(center),
    '',
    row(germanDate(r.date), r.time),
    row('Bon-Nr.', r.receiptNo),
    rule,
    ...r.items.map((item) => row(item.text, `${euro(item.cents)} ${letter(item.vat)}`)),
    rule,
    row('SUMME EUR', euro(total)),
    row(r.payment, euro(total)),
    '',
    ...vatLines,
    rule,
    center('Vielen Dank für Ihren Einkauf!'),
    center('Erfundener Beleg (Entwicklung)'),
  ];
}

/** Ein Kassenbon als schmale PDF-Seite — so sieht der Beleg in der Freigabe aus wie ein eingescannter Bon. */
export function receiptPdf(r: SeedReceipt): Uint8Array {
  const lines = receiptLines(r);
  const leading = 12;
  const height = 60 + lines.length * leading;
  return pdfPage({ width: 227, height, font: 'Courier', size: 9, leading, left: 12, top: height - 30 }, lines);
}
