import { isoDay, paperDate, type DocumentTemplate } from '@kompass/core';
import { z } from 'zod';
import { formatEuro } from '../../format/amount';

/**
 * Der Begleitzettel eines Einzugs (Spec § 7.4 Schritt 3): Beleg der Sammelbuchung in der Akte — Fälligkeit, Konto
 * gekürzt, Anzahl, Summe und je Posten Mandatsreferenz und Betrag. Keine IBAN eines Zahlers, kein Name: Die stehen in
 * der Datei für die Bank, nicht in der Akte. Modul-eigene Art `sepa-run-summary`, zehn Jahre.
 */
export const RUN_SUMMARY_TEMPLATE_KEY = 'sepa-run-summary';
export const RUN_SUMMARY_DOCUMENT_TYPE = 'sepa-run-summary';
export const RUN_SUMMARY_TITLE = 'Lastschrift-Sammelauftrag';

export const runSummaryInputSchema = z.object({
  collectionDate: z.iso.date(),
  accountName: z.string().min(1),
  /** Gekürzt (`maskIban`). */
  accountIban: z.string().min(1),
  creditorId: z.string().min(1),
  messageId: z.string().min(1),
  count: z.number().int().min(1),
  sumCents: z.number().int().positive(),
  items: z.array(z.object({ reference: z.string().min(1), amountCents: z.number().int().positive() })).min(1),
});
export type RunSummaryInput = z.infer<typeof runSummaryInputSchema>;

function body(data: RunSummaryInput): string {
  return [
    '| | |',
    '|---|---|',
    `| Fälligkeit | ${paperDate(isoDay(data.collectionDate))} |`,
    `| Konto | ${data.accountName}, ${data.accountIban} |`,
    `| Gläubiger-Identifikationsnummer | ${data.creditorId} |`,
    `| Nachrichten-Referenz | ${data.messageId} |`,
    `| Anzahl | ${data.count} |`,
    `| Summe | ${formatEuro(data.sumCents)} |`,
    '',
    '| Mandatsreferenz | Betrag |',
    '|---|---:|',
    ...data.items.map((i) => `| ${i.reference} | ${formatEuro(i.amountCents)} |`),
  ].join('\n');
}

export const runSummaryTemplate: DocumentTemplate<RunSummaryInput> = {
  key: RUN_SUMMARY_TEMPLATE_KEY,
  type: RUN_SUMMARY_DOCUMENT_TYPE,
  schema: runSummaryInputSchema,
  base: 'a4-mit-briefkopf',
  permission: 'finance.directDebit',
  build: (data) => ({ slots: { kind: 'report', title: RUN_SUMMARY_TITLE, subtitle: `Fälligkeit ${paperDate(isoDay(data.collectionDate))}` }, body: { markdown: body(data) } }),
};
