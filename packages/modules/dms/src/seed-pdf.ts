/**
 * Eine einseitige PDF mit Textebene, erzeugt ohne Werkzeug — für die
 * Entwicklungsdaten der Akte. Der Worker liest sie wie ein echtes digitales
 * Schreiben, die Volltextsuche findet ihren Inhalt.
 *
 * Bewusst von Hand statt über Typst: Der Seed läuft auch in Unit-Tests und im
 * E2E-Reset, wo es kein Typst geben muss, und eine Binärdatei im Paket hätte
 * einen eigenen Weg ins gebündelte Image gebraucht.
 */

/** Helvetica mit WinAnsi kennt ä, ö, ü und ß als einzelne Bytes (Latin-1). */
function latin1(text: string): Uint8Array {
  return Uint8Array.from(text, (ch) => {
    const code = ch.charCodeAt(0);
    if (code > 0xff) throw new Error(`Zeichen ausserhalb von Latin-1: ${ch}`);
    return code;
  });
}

const escape = (line: string) => line.replace(/[\\()]/g, (c) => `\\${c}`);

export function textPdf(lines: readonly string[]): Uint8Array {
  const content = ['BT', '/F1 11 Tf', '14 TL', '72 770 Td', ...lines.map((line) => `(${escape(line)}) Tj T*`), 'ET'].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
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
