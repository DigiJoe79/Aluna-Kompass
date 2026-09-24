/**
 * Offene Zahlung über die Zahlungsreferenz (F5, Spec 6.4 Vorschlag 3). Rein —
 * Wächter `suggest-purity.test.ts`.
 */
import { normalizeText } from './rule';

/**
 * Die offene Zahlung, deren Referenz als Ganzes im Verwendungszweck steht
 * (Vergleich wie `normalizeText`). Stehen mehrere darin, gewinnt die längste —
 * „RE-4711“ ist genauer als „RE-47“.
 */
export function findByReference(purpose: string, items: readonly { id: string; paymentReference: string | null }[]): string | null {
  const text = normalizeText(purpose);
  let best: { id: string; length: number } | null = null;
  for (const item of items) {
    const ref = normalizeText(item.paymentReference ?? '');
    if (ref.length === 0 || !text.includes(ref)) continue;
    if (!best || ref.length > best.length) best = { id: item.id, length: ref.length };
  }
  return best?.id ?? null;
}
