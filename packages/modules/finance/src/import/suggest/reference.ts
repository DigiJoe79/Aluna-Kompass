/**
 * Offene Zahlung über die Zahlungsreferenz (F5, Spec 6.4 Vorschlag 3). Rein —
 * Wächter `suggest-purity.test.ts`.
 */
import { normalizeText } from './rule';

/**
 * Die offenen Zahlungen, deren Referenz als Ganzes im Verwendungszweck steht
 * (Vergleich wie `normalizeText`). Stehen mehrere darin, gewinnt die längste —
 * „RE-4711“ ist genauer als „RE-47“. Teilen sich mehrere die längste (dieselbe
 * Rechnung zweimal erfasst, Befund Z), kommen alle zurück: Dann entscheidet der
 * Mensch, nicht die Reihenfolge.
 */
export function findByReference(purpose: string, items: readonly { id: string; paymentReference: string | null }[]): string[] {
  const text = normalizeText(purpose);
  let best: { ids: string[]; length: number } | null = null;
  for (const item of items) {
    const ref = normalizeText(item.paymentReference ?? '');
    if (ref.length === 0 || !text.includes(ref)) continue;
    if (!best || ref.length > best.length) best = { ids: [item.id], length: ref.length };
    else if (ref.length === best.length) best.ids.push(item.id);
  }
  return best?.ids ?? [];
}
