import { isoDay, paperDate, type DocumentTemplate } from '@kompass/core';
import { z } from 'zod';

const denominationSchema = z.object({ cents: z.number().int().positive(), count: z.number().int().min(0) });

const cashCountVariantSchema = z.object({
  variant: z.literal('cashCount').optional(),
  accountName: z.string().min(1),
  countedOn: z.iso.date(),
  bookAmount: z.string(),
  countedAmount: z.string(),
  differenceAmount: z.string(),
  kind: z.enum(['equal', 'surplus', 'shortage']),
  note: z.string().nullable(),
  denominations: z.array(denominationSchema).nullable(),
  counterOneName: z.string().min(1),
  counterTwoName: z.string().min(1),
});

/** AG: Die Leerung einer Spendendose ist keine Kassenzählung — kein Buchbestand, keine Differenz, sondern Inhalt und Buchung als Spende. */
const donationBoxVariantSchema = z.object({
  variant: z.literal('donationBox'),
  accountName: z.string().min(1),
  boxLabel: z.string().min(1),
  countedOn: z.iso.date(),
  amount: z.string(),
  categoryName: z.string().min(1),
  counterOneName: z.string().min(1),
  counterTwoName: z.string().min(1),
});

export const cashCountInputSchema = z.union([donationBoxVariantSchema, cashCountVariantSchema]);
export type CashCountTemplateInput = z.infer<typeof cashCountInputSchema>;

export type CashCountVariant = z.infer<typeof cashCountVariantSchema>;
type DonationBoxVariant = z.infer<typeof donationBoxVariantSchema>;

const DIFFERENCE_ROW_LABEL: Record<CashCountVariant['kind'], string> = {
  equal: 'Unterschied',
  surplus: 'Kassendifferenz (Mehr)',
  shortage: 'Kassenfehlbetrag (Weniger)',
};

/** „5,00 €“ → „5,00 €“ unverändert genutzt; nur die Stückelung braucht eine eigene Formatierung (Cent → Euro). */
function formatDenominationLabel(cents: number): string {
  return cents >= 100 ? `${cents / 100} €` : `${cents} Ct.`;
}

function signatureLines(lines: string[], data: { counterOneName: string; counterTwoName: string }): void {
  lines.push('', '', '__________________________  __________________________');
  lines.push(`${data.counterOneName}  ${data.counterTwoName}`);
}

function donationBoxBody(data: DonationBoxVariant): string {
  const lines: string[] = [
    '| | |',
    '|---|---|',
    `| Spendendose | ${data.boxLabel} |`,
    `| Datum | ${paperDate(isoDay(data.countedOn))} |`,
    `| Inhalt der Spendendose | ${data.amount} |`,
    `| Eingezahlt in | ${data.accountName} |`,
    '',
    `Gebucht als Spende (${data.categoryName}), ohne Zuordnung zu einer spendenden Person. Die Buchung trägt dieses Protokoll als Beleg.`,
  ];
  signatureLines(lines, data);
  return lines.join('\n');
}

function body(data: CashCountVariant): string {
  const lines: string[] = [
    '| | |',
    '|---|---|',
    `| Kasse | ${data.accountName} |`,
    `| Datum | ${paperDate(isoDay(data.countedOn))} |`,
    `| Buchbestand | ${data.bookAmount} |`,
    `| Gezählt | ${data.countedAmount} |`,
    `| ${DIFFERENCE_ROW_LABEL[data.kind]} | ${data.differenceAmount} |`,
  ];
  if (data.denominations && data.denominations.length > 0) {
    lines.push('', '**Stückelung**', '', '| Nennwert | Stück |', '|---|---|');
    for (const d of data.denominations) lines.push(`| ${formatDenominationLabel(d.cents)} | ${d.count} |`);
  }
  if (data.note) lines.push('', data.note);
  signatureLines(lines, data);
  return lines.join('\n');
}

/**
 * Das Zählprotokoll (Spec 4.4, 5.5): modul-eigene Dokumentart `finance-cash-count`
 * (Präfix KZP), Akteneintrag mit fortlaufender Nummer (`filed` in der
 * Vorgabe true). Rein aus geprüften Daten — die Namen der Zählenden stehen
 * hier, nie im Änderungsprotokoll (Spec 10.3).
 */
export const cashCountTemplate: DocumentTemplate<CashCountTemplateInput> = {
  key: 'finance-cash-count',
  type: 'finance-cash-count',
  schema: cashCountInputSchema,
  base: 'a4-mit-briefkopf',
  permission: 'finance.entriesFinalize',
  build: (data) =>
    data.variant === 'donationBox'
      ? { slots: { kind: 'report', title: `Leerung ${data.boxLabel}`, subtitle: paperDate(isoDay(data.countedOn)) }, body: { markdown: donationBoxBody(data) } }
      : { slots: { kind: 'report', title: `Kassenzählung ${data.accountName}`, subtitle: paperDate(isoDay(data.countedOn)) }, body: { markdown: body(data) } },
};
