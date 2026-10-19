/**
 * Der Überweisungsblock mit GiroCode für Briefe aller Module (Plan M4 Task 1, Handoff Mitglieder D7): Empfänger, IBAN
 * in Vierergruppen, BIC (wenn vorhanden), Betrag, Verwendungszweck und daneben der Code aus `qrRows`. Rein und ohne
 * Abhängigkeit vom Renderer, damit Module ihn über `@kompass/documents/transfer-block` einbinden.
 *
 * Wie beim Tierprofil (`animals/src/print/profile-lib.ts`) steht die Typst-Funktion als Text vor dem Körper; die
 * Vorlage setzt `TRANSFER_BLOCK_LIB` einmal davor und ruft `transferBlock(data)` an der Stelle des Blocks. Die
 * Beschriftungen kommen vom Aufrufer (Sprachtabelle seiner Vorlage), der Betrag fertig formatiert (`formatEuro`). Die
 * IBAN geht roh hinein und wird in Typst gruppiert (MUSTER „IBAN“). Einzige feste Farbe sind die schwarzen
 * QR-Module, wie im Tierprofil.
 */
export const TRANSFER_BLOCK_LIB = String.raw`
#let transfer-qr(rows, size) = {
  let n = rows.len()
  let m = size / n
  box(width: size, height: size, {
    for (y, row) in rows.enumerate() {
      for (x, c) in row.clusters().enumerate() {
        if c == "1" { place(top + left, dx: x * m, dy: y * m, rect(width: m + 0.05pt, height: m + 0.05pt, fill: black, stroke: none)) }
      }
    }
  })
}

#let transfer-block(d) = {
  let iban = d.iban.replace(" ", "").clusters().chunks(4).map(c => c.join()).join(" ")
  let rows = (
    (d.labels.recipient, d.name),
    (d.labels.iban, iban),
    ..if d.bic != none { ((d.labels.bic, d.bic),) } else { () },
    (d.labels.amount, d.amount),
    (d.labels.reference, d.reference),
  )
  let facts = grid(
    columns: (auto, 1fr), column-gutter: 4mm, row-gutter: 2mm,
    ..rows.map(r => (text(size: 9pt)[#r.at(0)], text(weight: "bold")[#r.at(1)])).flatten(),
  )
  block(width: 100%, breakable: false, stroke: 0.5pt, radius: 2pt, inset: 4mm, {
    text(size: 9pt, weight: "bold")[#d.labels.title]
    v(2mm)
    if d.qr == none { facts } else {
      grid(columns: (1fr, 30mm), column-gutter: 6mm, facts,
        align(center, { transfer-qr(d.qr, 30mm); v(1mm); text(size: 8pt)[#d.labels.qr] }))
    }
  })
}
`;

export interface TransferBlockLabels {
  title: string;
  recipient: string;
  iban: string;
  bic: string;
  amount: string;
  reference: string;
  qr: string;
}

export interface TransferBlockData {
  name: string;
  /** Roh, wie gespeichert; Typst gruppiert. */
  iban: string;
  bic: string | null;
  /** Fertig formatiert (`formatEuro`). */
  amount: string;
  reference: string;
  /** Zeilen aus `qrRows` mit der EPC-Nutzlast; `null` ohne Code (Nutzlast ungültig). */
  qr: string[] | null;
  labels: TransferBlockLabels;
}

/** Freitext als Typst-String-Literal: Darin wirkt nichts als Markup. */
const str = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ')}"`;
/** Typst-Array; ein einzelnes Element braucht das Komma. */
const arr = (items: string[]) => (items.length === 0 ? '()' : `(${items.join(', ')},)`);

/** Der Aufruf des Blocks im Körper einer Vorlage (davor einmal `TRANSFER_BLOCK_LIB`). */
export function transferBlock(data: TransferBlockData): string {
  const labels = Object.entries(data.labels).map(([k, v]) => `${k}: ${str(v)}`).join(', ');
  const fields = [
    `name: ${str(data.name)}`,
    `iban: ${str(data.iban.replace(/\s+/g, ''))}`,
    `bic: ${data.bic ? str(data.bic) : 'none'}`,
    `amount: ${str(data.amount)}`,
    `reference: ${str(data.reference)}`,
    `qr: ${data.qr ? arr(data.qr.map(str)) : 'none'}`,
    `labels: (${labels})`,
  ];
  return `#transfer-block((${fields.join(', ')}))`;
}
