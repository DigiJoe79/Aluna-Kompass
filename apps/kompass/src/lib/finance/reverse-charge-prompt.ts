import type { ReverseChargePromptView } from '@kompass/module-finance';
import { parseAmount } from './amount';

/**
 * Prüffrage § 13b (Plan E6b Task 4): die reinen Teile für Maske, Arbeitsliste und Rechnungsleser — die Eingabe des
 * Dienstes `checkReverseCharge` aus dem Stand einer Maske, das „Ja“ an den Zeilen und der Auslösersatz.
 */

export interface ReverseChargeCheckInput {
  contactId: string | null;
  documentId: string | null;
  rawTransactionId: string | null;
  lines: { amountCents: number; taxCode: string | null; categoryId?: string | null }[];
}

interface CheckRow {
  amountText: string;
  taxCode?: string;
  contactId: string | null;
  /** Die Kategorie: Eine Mittelweitergabe an Partner fragt der Dienst nicht (Designer Runde 8, Fachlich 1). */
  categoryId?: string;
}

/** Eingabe der Prüffrage aus den Aufteilungszeilen; `expense`: der eingegebene Betrag ist eine Ausgabe. */
export function reverseChargeCheckInput(rows: readonly CheckRow[], opts: { expense: boolean; documentId?: string | null; rawTransactionId?: string | null }): ReverseChargeCheckInput {
  const lines = rows.flatMap((r) => {
    const cents = parseAmount(r.amountText);
    if (cents === null) return [];
    return [{ amountCents: opts.expense ? -Math.abs(cents) : cents, taxCode: r.taxCode ?? null, categoryId: r.categoryId || null }];
  });
  return { contactId: rows.find((r) => r.contactId)?.contactId ?? null, documentId: opts.documentId ?? null, rawTransactionId: opts.rawTransactionId ?? null, lines };
}

/**
 * „Ja, § 13b“: das vorgeschlagene Kennzeichen an den Zeilen aus `lineIndexes`, Herkunft „aus der Prüffrage“. Die
 * Indizes zählen nur Zeilen mit lesbarem Betrag (wie `reverseChargeCheckInput`); Zeilen mit Kennzeichen bleiben.
 */
export function applyReverseChargeYes<R extends CheckRow & { taxCodeOrigin?: 'contact' | 'prompt' | null }>(rows: readonly R[], prompt: Pick<ReverseChargePromptView, 'lineIndexes' | 'suggestedCode'>): R[] {
  let index = -1;
  return rows.map((row) => {
    if (parseAmount(row.amountText) === null) return row;
    index += 1;
    if (!prompt.lineIndexes.includes(index) || (row.taxCode && row.taxCode !== 'none')) return row;
    return { ...row, taxCode: prompt.suggestedCode, taxCodeOrigin: 'prompt' };
  });
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Der Auslösersatz in der Sprache der Oberfläche; das Land als Name (`Intl.DisplayNames`). */
export function reverseChargeTriggerText(t: Translate, prompt: Pick<ReverseChargePromptView, 'trigger' | 'params'>, locale: string): string {
  const { trigger, params } = prompt;
  const country = params.country ? (new Intl.DisplayNames([locale], { type: 'region' }).of(params.country) ?? params.country) : t('trigger.unknownCountry');
  if (trigger === 'text') return params.page ? t('trigger.text', { phrase: params.phrase ?? '', page: params.page }) : t('trigger.textInvoice');
  if (trigger === 'foreignNoTax') return t('trigger.foreignNoTax', { country });
  return t(`trigger.${trigger}`, { country, rate: params.ratePercent ?? 0 });
}

/**
 * Designer Runde 8, 9c: Solange die Prüffrage steht, wiederholt die Hilfezeile der Kategorie sie nicht — die Sätze, die
 * § 13b nennen, fallen weg; der Rest der Erklärung bleibt. Die Erklärung ist Text der Kategorie (frei gepflegt), deshalb
 * nach Sätzen und nicht nach Schlüssel.
 */
export function withoutReverseChargeSentences(text: string): string {
  const sentences = text.match(/[^.?!]+[.?!]*\s*/g) ?? [];
  const drop = sentences.map((sentence) => /§\s*13b/.test(sentence));
  // Eine Frage, deren Antwort § 13b nennt („… ohne deutsche Umsatzsteuer? Dann ist es meist ein Fall des § 13b.“), gehört dazu.
  for (let i = sentences.length - 2; i >= 0; i--) if (drop[i + 1] && sentences[i]!.trim().endsWith('?')) drop[i] = true;
  return sentences.filter((_, i) => !drop[i]).join('').trim();
}
