/**
 * Baut ein minimales, gültiges PDF 1.7 mit einer leeren Seite und den
 * übergebenen Dateien als Anhänge (`/EmbeddedFiles`-Namensbaum, je Anhang ein
 * `/Filespec` und ein unkomprimierter `/EmbeddedFile`-Stream). Die
 * xref-Offsets werden berechnet — gleiche Eingabe, gleiche Bytes, kein
 * Zeitstempel, keine Zufalls-ID. So bleiben committete Fixtures aus diesem
 * Helfer reproduzierbar (Byte-Vergleich in `packages/text-extraction/tests/embedded.test.ts`
 * und `packages/modules/finance/tests/e2e-fixtures-zugferd.test.ts`).
 *
 * Im Kern und nicht bei `@kompass/text-extraction`, weil es zwei Pakete
 * brauchen, die einander nicht kennen dürfen: die Texterkennung (Tests) und
 * das Finanzmodul (Entwicklungsdaten und E2E-Fixtures der ZUGFeRD-Rechnungen,
 * F5b). Bewusst von Hand wie `textPdf` der Akte — der Seed läuft auch im
 * E2E-Reset, ganz ohne Werkzeug.
 */
export interface PdfAttachment {
  name: string;
  content: string | Uint8Array;
  /** MIME-Typ für `/Subtype`, etwa `text/xml`. */
  mimeType?: string;
}

const enc = new TextEncoder();

/** PDF-Literal-String: Klammern und Rückstrich maskieren. Nur ASCII-Namen. */
function pdfString(value: string): string {
  return `(${value.replace(/[\\()]/g, (c) => `\\${c}`)})`;
}

/** PDF-Name: `/` in `text/xml` wird zu `#2F`. */
function pdfName(value: string): string {
  return `/${value.replace(/[^A-Za-z0-9.+-]/g, (c) => `#${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)}`;
}

export function buildPdfWithAttachments(attachments: readonly PdfAttachment[]): Uint8Array {
  // Objekte: 1 Katalog, 2 Seiten, 3 Seite, dann je Anhang Filespec + Stream.
  const sorted = [...attachments].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const objects: Uint8Array[] = [];
  const names = sorted.map((a, i) => `${pdfString(a.name)} ${4 + i * 2} 0 R`).join(' ');
  const namesEntry = sorted.length > 0 ? ` /Names << /EmbeddedFiles << /Names [${names}] >> >>` : '';

  objects.push(enc.encode(`<< /Type /Catalog /Pages 2 0 R${namesEntry} >>`));
  objects.push(enc.encode('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
  objects.push(enc.encode('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>'));

  for (const [i, a] of sorted.entries()) {
    const streamId = 5 + i * 2;
    const body = typeof a.content === 'string' ? enc.encode(a.content) : a.content;
    const subtype = a.mimeType ? ` /Subtype ${pdfName(a.mimeType)}` : '';
    objects.push(enc.encode(`<< /Type /Filespec /F ${pdfString(a.name)} /UF ${pdfString(a.name)} /EF << /F ${streamId} 0 R >> >>`));
    objects.push(concat([enc.encode(`<< /Type /EmbeddedFile${subtype} /Length ${body.byteLength} >>\nstream\n`), body, enc.encode('\nendstream')]));
  }

  // Der Kommentar mit vier Bytes über 127 kennzeichnet die Datei als binär (PDF-Konvention).
  const parts: Uint8Array[] = [enc.encode('%PDF-1.7\n'), new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])];
  let offset = parts.reduce((n, p) => n + p.byteLength, 0);
  const offsets: number[] = [];
  for (const [i, obj] of objects.entries()) {
    offsets.push(offset);
    const chunk = concat([enc.encode(`${i + 1} 0 obj\n`), obj, enc.encode('\nendobj\n')]);
    parts.push(chunk);
    offset += chunk.byteLength;
  }

  const xref = [
    'xref',
    `0 ${objects.length + 1}`,
    '0000000000 65535 f ',
    ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n `),
    'trailer',
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    'startxref',
    String(offset),
    '%%EOF',
    '',
  ].join('\n');
  parts.push(enc.encode(xref));
  return concat(parts);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}
