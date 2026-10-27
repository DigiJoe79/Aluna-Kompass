import { notFound, ok, todayIn, validate, type CallContext, type Deps, type Result } from '@kompass/core';
import { contacts, displayName } from '@kompass/module-contacts';
import { getDocumentText } from '@kompass/module-dms';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { requireFinanceRead } from '../ledger/access';
import { EU_MEMBER_STATES } from '../ledger/codes';
import { valueAt } from '../ledger/dated-values';
import { vatProfileAt } from '../ledger/vat-settings';
import { financeCategories, financeContactTaxDetails, financePartnerProfiles, financeRawTransactions } from '../schema';
import { loadInvoiceInternal } from './zugferd/read';

/**
 * Prüffrage § 13b beim Buchen (Spec E6 Teil 3, Recherche § 6, Plan E6b Task 2). In `import/`, weil sie die
 * ZUGFeRD-Rechnung liest (`zugferd/read.ts`) und `ledger/` nichts außer sich selbst importiert (`direction.test.ts`). Kompass fragt, setzt aber nichts:
 * Höchstens eine Frage je Eingabe, mit dem Auslöser, der sie ausgelöst hat. Vorrang: Belegtext → ausländische
 * Umsatzsteuer → deutsche Umsatzsteuer eines Auslandsanbieters → Auslandssitz ohne Steuer. Eine ZUGFeRD-Kategorie `AE`
 * fragt nicht: Sie setzt das Kennzeichen als Vorgabe aus der Rechnung.
 * Keine Anbieterliste (Recherche § 3): nur Merkmale von Beleg, Kontakt und Zahlung.
 */

/**
 * Pflichtangabe auf der Rechnung bei Umkehr der Steuerschuld, Groß-/Kleinschreibung egal:
 * - „Steuerschuldnerschaft des Leistungsempfängers“: § 14a Abs. 1 S. 1 und Abs. 5 S. 1 UStG
 *   (gesetze-im-internet.de/ustg_1980/__14a.html, abgerufen 25.10.2026).
 * - „Reverse charge“: Art. 226 Nr. 11a MwStSystRL 2006/112/EG, englische Fassung „the mention ‘Reverse charge’“
 *   (legislation.gov.uk/eudr/2006/112/article/226, abgerufen 25.10.2026), auch mit Bindestrich geschrieben.
 * - „Btw verlegd“: niederländische Fassung von Art. 226 Nr. 11a, bestätigt über das belgische Rundschreiben 2023/C/51
 *   („de vermelding ‚btw verlegd‘ … artikel 226, 11bis“), abgerufen 25.10.2026.
 * - „Autoliquidation“: französische Fassung; nur über Sekundärquellen zur Rechnungsangabe in Frankreich bestätigt,
 *   der amtliche Wortlaut von Art. 226 Nr. 11 bis war am 25.10.2026 nicht abrufbar.
 * - „Article 196“: Verweis auf Art. 196 MwStSystRL, wie ihn EU-Anbieter oft statt des Wortlauts setzen (Recherche § 6).
 * Ein fehlender Hinweis ändert die Pflicht nicht (UStAE 13b.14 Abs. 1 S. 4, Recherche § 6) — darum gibt es auch den
 * Auslöser `foreignNoTax`.
 */
export const REVERSE_CHARGE_PHRASES: readonly string[] = ['Steuerschuldnerschaft des Leistungsempfängers', 'Reverse Charge', 'Reverse-Charge', 'Article 196', 'Autoliquidation', 'Btw verlegd'];

import { PARTNER_GRANT_CATEGORY_KEYS } from '../ledger/codes';

export { PARTNER_GRANT_CATEGORY_KEYS };

export type ReverseChargeTrigger = 'text' | 'foreignNoTax' | 'foreignVat' | 'germanVatAbroad';

export interface ReverseChargePromptView {
  trigger: ReverseChargeTrigger;
  /** Werte für den Auslösersatz: `phrase`/`page` (text), `country` (ISO-2), `ratePercent` (foreignVat, germanVatAbroad). */
  params: { phrase?: string; page?: number | null; country?: string | null; ratePercent?: number };
  contact: { id: string; name: string; country: string | null } | null;
  /** Kennzeichen für „Ja“: nach dem Land (Kontakt, sonst Gegen-IBAN, sonst USt-IdNr. des Ausstellers). */
  suggestedCode: 'rc13bEu' | 'rc13bOther';
  /** Indizes der Zeilen der Eingabe, die „Ja“ kennzeichnet (Ausgaben ohne Kennzeichen). */
  lineIndexes: number[];
}

const normalize = (text: string) => text.toLowerCase().replace(/[\s ]+/g, ' ');

/** Rein: der erste Hinweis auf die Umkehr der Steuerschuld im Belegtext, mit Seite. */
export function findReverseChargePhrase(pages: readonly { page: number; text: string }[]): { phrase: string; page: number } | null {
  for (const p of pages) {
    const text = normalize(p.text);
    const phrase = REVERSE_CHARGE_PHRASES.find((candidate) => text.includes(normalize(candidate)));
    if (phrase) return { phrase, page: p.page };
  }
  return null;
}

/** Rein: das Land einer USt-IdNr. als ISO-2 (`EL` → `GR`), sonst `null`. */
export function countryOfVatId(vatId: string | null): string | null {
  const prefix = vatId?.replace(/\s+/g, '').slice(0, 2).toUpperCase() ?? '';
  if (!/^[A-Z]{2}$/.test(prefix)) return null;
  return prefix === 'EL' ? 'GR' : prefix;
}

/** Die gesammelten Fakten einer Prüffrage — Eingabe des reinen Entscheiders. */
export interface ReverseChargeFacts {
  entrepreneur: boolean;
  /**
   * Der Verein hat eine USt-IdNr. Ohne Unternehmereigenschaft entscheidet sie, wie weit gefragt wird: Die juristische
   * Person schuldet nach § 13b Abs. 5 S. 1 UStG für Abs. 1 und Abs. 2 Nr. 1–3 (UStAE 13b.1 Abs. 1, 3a.16 Abs. 2); Abs. 1
   * setzt § 3a Abs. 2 voraus, der sie nur mit USt-IdNr. erfasst (§ 3a Abs. 2 S. 3, UStAE 3a.2 Abs. 7, 3a.1 Abs. 1).
   * Fehlt das Feld, gilt „keine“.
   */
  vatId?: boolean;
  /** `grant`: als Mittelweitergabe gebucht (Kategorie der Partnerzahlungen) — keine Leistung, nie gefragt. */
  lines: readonly { amountCents: number; taxCode: string | null; grant?: boolean }[];
  /** `partner`: Der Kontakt ist ein Partner — Mittel an ihn sind keine Leistung (Joe 2026-10-26, Designer Runde 8). */
  contact: { id: string; name: string; country: string | null; reverseCharge: boolean; declined: boolean; partner?: boolean } | null;
  ibanCountry: string | null;
  /** Belegtext, wenn lesbar und erkannt. */
  pages: readonly { page: number; text: string }[];
  /** ZUGFeRD-Rechnung des Belegs, wenn vorhanden. */
  invoice: { sellerVatId: string | null; taxTotalCents: number; taxes: readonly { ratePercent: number; categoryCode: string }[]; germanRates: readonly number[] } | null;
}

const foreign = (country: string | null): country is string => country !== null && country !== 'DE';

/**
 * Rein: Vorbedingungen der Prüffrage — Unternehmer oder juristische Person (jeder Verein: § 13b Abs. 5 S. 1 UStG, Befund
 * 37), mindestens eine Ausgabezeile ohne Kennzeichen, Kontakt ohne Merkmal,
 * ohne gemerktes Nein und kein Partner; Zeilen einer Mittelweitergabe zählen nicht (Joe 2026-10-26: Mittel an einen
 * Partner sind keine Leistung, dieselbe Art Regel wie die Rückgabe einer Spende nur bei Spendern). Liefert die Zeilen,
 * die „Ja“ kennzeichnet, sonst `null`.
 */
function askableLines(facts: Pick<ReverseChargeFacts, 'lines' | 'contact'>): number[] | null {
  if (facts.contact?.reverseCharge || facts.contact?.declined || facts.contact?.partner) return null;
  const lineIndexes = facts.lines.flatMap((l, i) => (l.amountCents < 0 && !l.grant && (l.taxCode === null || l.taxCode === '' || l.taxCode === 'none') ? [i] : []));
  return lineIndexes.length === 0 ? null : lineIndexes;
}

/** Rein: höchstens eine Prüffrage aus den Fakten (Regeln und Vorrang siehe Kopf). */
export function decideReverseChargePrompt(facts: ReverseChargeFacts): ReverseChargePromptView | null {
  const lineIndexes = askableLines(facts);
  if (lineIndexes === null) return null;

  const contactCountry = facts.contact?.country ?? null;
  const sellerCountry = countryOfVatId(facts.invoice?.sellerVatId ?? null);
  const country = contactCountry ?? facts.ibanCountry ?? sellerCountry;
  // Ohne Unternehmereigenschaft und ohne USt-IdNr. bleibt nur § 13b Abs. 2 Nr. 1 (Leistung am Grundstück, Werklieferung im
  // Inland, Recherche 2026-10-26 A.2): Vorschlag immer Kz 84/85, auch beim EU-Anbieter.
  const onlyOther = !facts.entrepreneur && !facts.vatId;
  const suggestedCode = !onlyOther && country !== null && country !== 'DE' && EU_MEMBER_STATES.includes(country) ? 'rc13bEu' : 'rc13bOther';
  const contact = facts.contact ? { id: facts.contact.id, name: facts.contact.name, country: facts.contact.country } : null;
  const prompt = (trigger: ReverseChargeTrigger, params: ReverseChargePromptView['params']): ReverseChargePromptView => ({ trigger, params, contact, suggestedCode, lineIndexes });

  const invoice = facts.invoice;
  // Kategorie AE: Die Rechnung setzt das Kennzeichen selbst als Vorgabe („aus der Rechnung“, `zugferd/read.ts`) — kein
  // unsicherer Auslöser, also keine Frage (Joe 2026-10-26, Designer Runde 8, Fachlich 2).
  if (invoice?.taxes.some((t) => t.categoryCode === 'AE')) return null;
  const found = findReverseChargePhrase(facts.pages);
  if (found) return prompt('text', found);

  if (invoice && invoice.taxTotalCents !== 0) {
    // Ohne beides keine Frage bei ausgewiesener Steuer: Ausländische Steuer heißt Ort im Ausland (§ 3a Abs. 1), deutsche
    // Steuer hat der Anbieter selbst erhoben — so bei elektronischen Leistungen über das OSS (UStAE 3a.16 Abs. 11–12,
    // § 18j UStG; nach dem Wortlaut von § 13b Abs. 2 Nr. 1 unklar, Recherche A.2): nur fragen, wenn keine Steuer da steht.
    if (onlyOther) return null;
    const ratePercent = Math.max(...invoice.taxes.map((t) => t.ratePercent), 0);
    const issuer = sellerCountry ?? contactCountry;
    // Ausländische Steuer: ein Satz, den Deutschland nicht kennt. Deutsche Steuer vom Auslandsanbieter: ein deutscher
    // Satz ohne deutsche USt-IdNr. des Ausstellers (UStAE 13b.11 Abs. 1 S. 6 — mit ihr gilt er als im Inland ansässig).
    const germanRate = invoice.germanRates.includes(ratePercent);
    if (!germanRate && foreign(issuer)) return prompt('foreignVat', { country: issuer, ratePercent });
    if (germanRate && sellerCountry !== 'DE' && foreign(sellerCountry ?? contactCountry)) return prompt('germanVatAbroad', { country: sellerCountry ?? contactCountry, ratePercent });
    return null;
  }

  const seat = contactCountry ?? facts.ibanCountry;
  if (foreign(seat)) return prompt('foreignNoTax', { country: seat });
  return null;
}

const checkSchema = z.object({
  contactId: z.string().min(1).nullable().optional(),
  documentId: z.string().min(1).nullable().optional(),
  rawTransactionId: z.string().min(1).nullable().optional(),
  lines: z.array(z.object({ amountCents: z.number().int(), taxCode: z.string().nullable().optional(), categoryId: z.string().min(1).nullable().optional() })).max(200),
});

/**
 * `finance.read`: Soll Kompass beim Buchen nach § 13b fragen? Liest Kontakt (Land, Merkmal, gemerktes Nein), Beleg
 * (ZUGFeRD über die Akte, Text über `getDocumentText`) und Kontoumsatz (Gegen-IBAN). Ohne Leserecht auf den Beleg
 * oder ohne erkannten Text wird der Beleg übergangen, nicht abgelehnt — die Prüffrage ist ein Hinweis. Liest nur.
 */
export async function checkReverseCharge(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ prompt: ReverseChargePromptView | null }>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, checkSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const db = deps.db;

  let contact: ReverseChargeFacts['contact'] = null;
  if (v.contactId) {
    const row = db.select().from(contacts).where(eq(contacts.id, v.contactId)).get();
    if (!row) return notFound('contact', v.contactId);
    // Merkmal und gemerktes Nein (`allocation/contact-tax-details.ts`) direkt aus der Tabelle: `import/` kennt nur `ledger/`.
    const details = db.select({ reverseCharge: financeContactTaxDetails.reverseCharge, declined: financeContactTaxDetails.reverseChargeDeclineReason }).from(financeContactTaxDetails).where(eq(financeContactTaxDetails.contactId, row.id)).get();
    // Partner direkt aus der Tabelle wie das Merkmal: `import/` kennt `allocation/` nicht.
    const partner = Boolean(db.select({ id: financePartnerProfiles.id }).from(financePartnerProfiles).where(eq(financePartnerProfiles.contactId, row.id)).get());
    contact = { id: row.id, name: displayName(row), country: row.country ? row.country.toUpperCase() : null, reverseCharge: details?.reverseCharge != null, declined: details?.declined != null, partner };
  }

  let ibanCountry: string | null = null;
  if (v.rawTransactionId) {
    const raw = db.select({ iban: financeRawTransactions.counterpartyIban }).from(financeRawTransactions).where(eq(financeRawTransactions.id, v.rawTransactionId)).get();
    if (!raw) return notFound('rawTransaction', v.rawTransactionId);
    ibanCountry = raw.iban && /^[A-Za-z]{2}/.test(raw.iban) ? raw.iban.slice(0, 2).toUpperCase() : null;
  }

  const grantCategories = new Set(db.select({ id: financeCategories.id }).from(financeCategories).where(inArray(financeCategories.key, [...PARTNER_GRANT_CATEGORY_KEYS])).all().map((c) => c.id));
  const lines = v.lines.map((l) => ({ amountCents: l.amountCents, taxCode: l.taxCode ?? null, grant: l.categoryId ? grantCategories.has(l.categoryId) : false }));
  const today = todayIn(deps);
  const profile = vatProfileAt(db, today);
  // Teure Lesungen (Akte, Anhänge) nur, wenn überhaupt gefragt werden könnte.
  const base: ReverseChargeFacts = { entrepreneur: profile.entrepreneur, vatId: profile.vatId !== null, lines, contact, ibanCountry, pages: [], invoice: null };
  if (askableLines(base) === null) return ok({ prompt: null });

  let pages: ReverseChargeFacts['pages'] = [];
  let invoice: ReverseChargeFacts['invoice'] = null;
  if (v.documentId) {
    const loaded = await loadInvoiceInternal(deps, ctx, v.documentId).catch(() => null);
    if (loaded?.ok && loaded.value.state === 'invoice') {
      const inv = loaded.value.invoice;
      const germanRates = [valueAt(db, 'vatStandard', inv.issueDate), valueAt(db, 'vatReduced', inv.issueDate)].filter((r): r is number => typeof r === 'number');
      invoice = { sellerVatId: inv.sellerVatId, taxTotalCents: inv.taxTotalCents, taxes: inv.taxes, germanRates };
    }
    const text = await getDocumentText(deps, ctx, { documentId: v.documentId });
    if (text.ok) pages = text.value.pages;
  }
  return ok({ prompt: decideReverseChargePrompt({ ...base, pages, invoice }) });
}
