import qrcode from 'qrcode-generator';

/** Vier Module Rand wie beim GiroCode der App (ISO 18004), sonst lesen Kameras den Code unzuverlässig. */
export const QR_QUIET_ZONE = 4;

/**
 * Die Modulmatrix eines QR-Codes als Zeilen aus `0` und `1`, samt Rand. Die
 * Vorlage zeichnet daraus Quadrate; so braucht es weder ein Typst-Paket noch
 * ein drittes Bildformat. Fehlerkorrektur M wie in `components/ui/qr-code.tsx`.
 */
export function qrRows(text: string): string[] {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const count = qr.getModuleCount();
  const pad = '0'.repeat(QR_QUIET_ZONE);
  const blank = '0'.repeat(count + 2 * QR_QUIET_ZONE);
  const rows = Array.from({ length: count }, (_, row) => pad + Array.from({ length: count }, (_, col) => (qr.isDark(row, col) ? '1' : '0')).join('') + pad);
  return [...Array<string>(QR_QUIET_ZONE).fill(blank), ...rows, ...Array<string>(QR_QUIET_ZONE).fill(blank)];
}
