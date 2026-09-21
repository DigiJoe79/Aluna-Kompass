import type { DocumentTemplate } from '@kompass/core';
import { z } from 'zod';

const denominationSchema = z.object({ cents: z.number().int().positive(), count: z.number().int().min(0) });

export const cashCountInputSchema = z.object({
  accountName: z.string().min(1),
  countedOn: z.string(),
  bookAmount: z.string(),
  countedAmount: z.string(),
  differenceAmount: z.string(),
  kind: z.enum(['equal', 'surplus', 'shortage']),
  note: z.string().nullable(),
  denominations: z.array(denominationSchema).nullable(),
  counterOneName: z.string().min(1),
  counterTwoName: z.string().min(1),
});
export type CashCountTemplateInput = z.infer<typeof cashCountInputSchema>;

const DIFFERENCE_ROW_LABEL: Record<CashCountTemplateInput['kind'], string> = {
  equal: 'Unterschied',
  surplus: 'Kassendifferenz (Mehr)',
  shortage: 'Kassenfehlbetrag (Weniger)',
};

/** „5,00 €“ → „5,00 €“ unverändert genutzt; nur die Stückelung braucht eine eigene Formatierung (Cent → Euro). */
function formatDenominationLabel(cents: number): string {
  return cents >= 100 ? `${cents / 100} €` : `${cents} Ct.`;
}

function body(data: CashCountTemplateInput): string {
  const lines: string[] = [
    '| | |',
    '|---|---|',
    `| Kasse | ${data.accountName} |`,
    `| Datum | ${data.countedOn} |`,
    `| Buchbestand | ${data.bookAmount} |`,
    `| Gezählt | ${data.countedAmount} |`,
    `| ${DIFFERENCE_ROW_LABEL[data.kind]} | ${data.differenceAmount} |`,
  ];
  if (data.denominations && data.denominations.length > 0) {
    lines.push('', '**Stückelung**', '', '| Nennwert | Stück |', '|---|---|');
    for (const d of data.denominations) lines.push(`| ${formatDenominationLabel(d.cents)} | ${d.count} |`);
  }
  if (data.note) lines.push('', data.note);
  lines.push('', '', '__________________________  __________________________');
  lines.push(`${data.counterOneName}  ${data.counterTwoName}`);
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
  build: (data) => ({
    slots: { kind: 'report', title: `Kassenzählung ${data.accountName}`, subtitle: data.countedOn },
    body: { markdown: body(data) },
  }),
};
