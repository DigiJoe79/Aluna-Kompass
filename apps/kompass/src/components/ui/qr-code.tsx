import qrcode from 'qrcode-generator';

/** Quiet Zone nach EPC069-12 / ISO 18004: vier Module Rand, sonst lesen Banking-Apps den Code nicht zuverlässig. */
const QUIET_ZONE = 4;

/**
 * EPC-QR (GiroCode) als `<svg>` (Plan N5 Task 2): die Modulmatrix kommt aus
 * `qrcode-generator`, gerendert als eigene `<rect>`-Elemente — kein
 * `dangerouslySetInnerHTML`. Immer schwarz auf weiß (Review Focus 5),
 * unabhängig vom Theme; Fehlerkorrektur M. Nichts daran ist interaktiv, die
 * Komponente läuft als Server-Komponente. `null`, wenn keine Nutzlast da ist
 * — der Baustein zeigt dann weiterhin nur den Hinweis ohne IBAN.
 */
export function QrCode({ payload, size, label }: { payload: string | null | undefined; size: number; label: string }) {
  if (!payload) return null;

  const qr = qrcode(0, 'M');
  qr.addData(payload, 'Byte');
  qr.make();
  const count = qr.getModuleCount();
  const dimension = count + QUIET_ZONE * 2;

  const modules: React.ReactNode[] = [];
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) modules.push(<rect key={`${row}-${col}`} x={col + QUIET_ZONE} y={row + QUIET_ZONE} width={1} height={1} fill="#000" />);
    }
  }

  return (
    <svg viewBox={`0 0 ${dimension} ${dimension}`} width={size} height={size} role="img" aria-label={label} shapeRendering="crispEdges" xmlns="http://www.w3.org/2000/svg">
      <rect x={0} y={0} width={dimension} height={dimension} fill="#fff" />
      {modules}
    </svg>
  );
}
