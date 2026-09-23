import { z } from 'zod';

const column = z.string().trim().min(1).max(120);

/**
 * Ein CSV-Format (Spec 6.2; in der Oberfläche „CSV-Format“): wie Kompass die
 * Datei eines Kontos liest. Spalten stehen mit ihrem Namen aus der Kopfzeile,
 * nicht mit ihrer Position — eine umsortierte Datei ist eine andere Datei
 * und fällt über `headerSignature` auf.
 */
export const csvFormatSchema = z
  .object({
    encoding: z.enum(['utf-8', 'windows-1252', 'iso-8859-1']),
    delimiter: z.enum([';', ',', '\t', '|']),
    /** Datensatz der Kopfzeile, ab 0 — manche Banken schreiben Kontodaten davor. */
    headerRow: z.number().int().min(0).max(30),
    /** Signatur der Kopfzeile beim Einrichten. Passt eine Datei nicht, wird nie still falsch gelesen. */
    headerSignature: z.string().min(1).max(4000),
    dateFormat: z.enum(['DD.MM.YYYY', 'DD.MM.YY', 'YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY']),
    decimalSeparator: z.enum([',', '.']),
    columns: z.object({
      bookingDate: column,
      valueDate: column.nullable(),
      /** Entweder ein Betrag mit Vorzeichen … */
      amount: column.nullable(),
      /** … oder getrennte Spalten für Soll (Ausgang) und Haben (Eingang). */
      debit: column.nullable(),
      credit: column.nullable(),
      /** Optional: Kennzeichen S/H — Werte, die „Ausgang“ bedeuten. */
      debitCreditIndicator: z.object({ column, debitValues: z.array(z.string().trim().min(1)).min(1) }).nullable(),
      counterpartyName: column.nullable(),
      counterpartyIban: column.nullable(),
      purpose: column.nullable(),
      /** Eindeutige Referenz des Dienstes (z. B. Transaktionscode) — wird zur Bankreferenz, dann greift der sichere Dublettenschutz. */
      reference: column.nullable(),
      /** Gebühr je Zeile — ergibt einen zweiten Kontoumsatz (F4b, Entscheidung 3). */
      fee: column.nullable(),
      /** Kontostand nach der Zeile — liefert Anfangs- und Endsaldo und die Saldenprobe. */
      balance: column.nullable(),
      /** Währung je Zeile; alles außer EUR lässt den Lauf scheitern (F4b, Entscheidung 2). */
      currency: column.nullable(),
      /** Vorgemerkte Zeilen: Spalte und Werte, die „vorgemerkt“ bedeuten. */
      pending: z.object({ column, values: z.array(z.string().trim().min(1)).min(1) }).nullable(),
    }),
    /** Antwort auf die Vorzeichenfrage des Assistenten: Die Datei führt Ausgänge positiv. */
    invertSign: z.boolean(),
  })
  .superRefine((f, ctx) => {
    const c = f.columns;
    const single = c.amount !== null;
    const split = c.debit !== null && c.credit !== null;
    if (single === split) ctx.addIssue({ code: 'custom', path: ['columns', 'amount'], message: 'amountOrDebitCredit' });
    if (!single && (c.debit === null) !== (c.credit === null)) ctx.addIssue({ code: 'custom', path: ['columns', 'debit'], message: 'amountOrDebitCredit' });
    if (c.counterpartyName === null && c.purpose === null) ctx.addIssue({ code: 'custom', path: ['columns', 'purpose'], message: 'nameOrPurpose' });
  });

export type CsvFormat = z.infer<typeof csvFormatSchema>;

/** Kopfzellen getrimmt, klein, Leerraum zusammengefasst, mit `|` verbunden. */
export function headerSignature(header: readonly string[]): string {
  return header.map(normalizeHeaderCell).join('|');
}

export function normalizeHeaderCell(cell: string): string {
  return cell.trim().toLowerCase().replace(/\s+/g, ' ');
}
