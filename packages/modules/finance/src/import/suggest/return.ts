/**
 * Zurückgegebene Zahlung (F5, Spec 6.4 Vorschlag 2; Annahme 7): nur, wenn die
 * Bank einen Rückgabe-Code liefert (CAMT). Rein — Wächter `suggest-purity.test.ts`.
 */
import { daysApart, type RawLike } from './pair';
import { normalizeText } from './rule';

/** Wie weit eine Rückgabe höchstens hinter der ursprünglichen Zahlung liegt. */
export const RETURN_WINDOW_DAYS = 60;

const compactIban = (iban: string): string => iban.replace(/\s+/g, '').toUpperCase();

const inWindow = (b: RawLike, target: RawLike) => b.bookingDate <= target.bookingDate && daysApart(b.bookingDate, target.bookingDate) <= RETURN_WINDOW_DAYS;

/**
 * Die gebuchte Zahlung, die ein Umsatz mit Rückgabe-Code zurückgibt. Zuerst
 * über die `EndToEndId` (Befund 37: die Bank reicht sie bei einer R-Transaktion
 * durch, sie trennt gleich hohe Lastschriften derselben Person), dann über
 * gleiche IBAN; beides mit genau negiertem Betrag, nicht später und höchstens
 * 60 Tage früher. Bei mehreren die jüngste.
 */
export function findReturnOrigin<T extends RawLike & { endToEndId?: string | null }>(target: RawLike & { returnCode: string | null; endToEndId?: string | null }, booked: readonly T[]): T | null {
  if (!target.returnCode) return null;
  const latest = (matches: T[]) => matches.reduce<T | null>((best, b) => (!best || b.bookingDate > best.bookingDate ? b : best), null);
  const candidates = booked.filter((b) => b.amountCents === -target.amountCents && inWindow(b, target));
  if (target.endToEndId) {
    const byEndToEnd = latest(candidates.filter((b) => b.endToEndId === target.endToEndId));
    if (byEndToEnd) return byEndToEnd;
  }
  if (!target.counterpartyIban) return null;
  const iban = compactIban(target.counterpartyIban);
  return latest(candidates.filter((b) => b.counterpartyIban !== null && compactIban(b.counterpartyIban) === iban));
}

/**
 * Befund 30a: ohne Gegen-IBAN (etwa eine Rücklastschrift ohne IBAN im
 * Bankdatensatz) über Rückgabe-Code, genau negierten Betrag und
 * gleichlautende Gegenpartei im selben 60-Tage-Fenster — nie „sicher“, weil
 * ein Name allein weniger eindeutig ist als eine IBAN. Bei mehreren
 * Treffern alle zurückgeben, jüngste zuerst — der Aufrufer stellt sie als
 * Rückfrage dar, statt zu raten.
 */
export function findReturnOriginsByName<T extends RawLike & { counterpartyName: string | null }>(
  target: RawLike & { returnCode: string | null; counterpartyName: string | null },
  booked: readonly T[],
): T[] {
  if (!target.returnCode || !target.counterpartyName) return [];
  const name = normalizeText(target.counterpartyName);
  if (!name) return [];
  return booked
    .filter((b) => b.counterpartyName !== null && normalizeText(b.counterpartyName) === name)
    .filter((b) => b.amountCents === -target.amountCents)
    .filter((b) => b.bookingDate <= target.bookingDate && daysApart(b.bookingDate, target.bookingDate) <= RETURN_WINDOW_DAYS)
    .sort((a, b) => b.bookingDate.localeCompare(a.bookingDate));
}

/** Plan L3: Wie weit eine Rückgabe ohne Mandat (`MD01`, nicht autorisiert) hinter dem Einzug liegen kann — 13 Monate. */
export const UNAUTHORISED_RETURN_WINDOW_DAYS = 396;

/** Was die Suche vom Posten eines Einzugs braucht. */
export interface DebitItemLike {
  id: string;
  endToEndId: string;
  mandateReference: string;
  amountCents: number;
  collectionDate: string;
  accountId: string;
}

/**
 * Plan L3 (Spec § 7.7): der Posten eines Einzugs, den eine Rücklastschrift zurückgibt. Zuerst über die End-to-End-ID
 * (sie ist je Posten eindeutig), sonst über die Mandatsreferenz und den Betrag — der Rückbetrag ist der Posten, oder
 * mehr um ein Rückgabeentgelt bis zur Toleranz —, eingezogen höchstens 60 Tage vor der Rückgabe, bei `MD01` 13 Monate.
 * Bei mehreren der jüngste Einzug.
 */
export function findReturnedItem<T extends DebitItemLike>(
  target: RawLike & { returnCode: string | null; endToEndId?: string | null; mandateReference?: string | null },
  items: readonly T[],
  opts: { feeToleranceCents: number },
): T | null {
  if (!target.returnCode || target.amountCents >= 0) return null;
  const sameAccount = items.filter((i) => i.accountId === target.accountId && i.collectionDate <= target.bookingDate);
  if (target.endToEndId) {
    const byEndToEnd = sameAccount.find((i) => i.endToEndId === target.endToEndId);
    if (byEndToEnd) return byEndToEnd;
  }
  if (!target.mandateReference) return null;
  const back = -target.amountCents;
  const window = target.returnCode === 'MD01' ? UNAUTHORISED_RETURN_WINDOW_DAYS : RETURN_WINDOW_DAYS;
  return sameAccount
    .filter((i) => i.mandateReference === target.mandateReference && back >= i.amountCents && back - i.amountCents <= opts.feeToleranceCents)
    .filter((i) => daysApart(i.collectionDate, target.bookingDate) <= window)
    .reduce<T | null>((best, i) => (!best || i.collectionDate > best.collectionDate ? i : best), null);
}
