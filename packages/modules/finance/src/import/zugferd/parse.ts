import { decodeXmlEntities, guardXml, secureXmlParser } from '../xml';

/**
 * Der reine Leser einer ZUGFeRD-/Factur-X-/XRechnung-Rechnung in der Syntax
 * Cross Industry Invoice (UN/CEFACT CII D16B), Spec 6.6. Alle Profile von
 * MINIMUM bis EXTENDED tragen dieselben Kopf- und Summenfelder; gelesen
 * werden nur diese — nie die Positionen. Keine Datenbank, kein `deps` —
 * Bytes hinein, Rechnung oder genannter Fehler heraus, nie ein Wurf.
 *
 * Sicherheit wie beim Kontoauszug (`../xml`): Größenlimit, DOCTYPE/ENTITY
 * abgelehnt, Validator, Parser ohne Entitäten. Beträge werden aus dem
 * Dezimaltext in Cent zerlegt, nie über Gleitkomma.
 */

export interface InvoiceTax {
  ratePercent: number;
  /** UNTDID 5305: `S` Standard, `E` befreit, `AE` Reverse Charge, `Z` Nullsatz … */
  categoryCode: string;
  basisCents: number;
  taxCents: number;
}

export interface ParsedInvoice {
  /** GuidelineSpecifiedDocumentContextParameter/ID — das Profil, etwa `urn:factur-x.eu:1p0:minimum`. */
  profile: string | null;
  invoiceNumber: string;
  /** YYYY-MM-DD */
  issueDate: string;
  /** UNTDID 1001: 380 Rechnung, 381 Gutschrift … */
  typeCode: string;
  sellerName: string;
  sellerVatId: string | null;
  buyerName: string | null;
  currency: string;
  /** Bei einer Gutschrift (381) sind alle Beträge negativ. */
  grandTotalCents: number;
  duePayableCents: number;
  taxTotalCents: number;
  /** Die Steueraufschlüsselung des Kopfes; MINIMUM hat keine. */
  taxes: InvoiceTax[];
  dueDate: string | null;
  paymentReference: string | null;
  /** Ohne Leerzeichen, in Großbuchstaben. */
  payeeIban: string | null;
}

export type ParseInvoiceResult =
  | { ok: true; invoice: ParsedInvoice }
  | { ok: false; code: 'notAnInvoice' | 'xmlInvalid' | 'xmlTooLarge' | 'doctypeRefused' | 'missingField'; field?: string };

/** Höchstgröße der XML (Annahme 6). */
export const INVOICE_XML_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Nur Anhänge mit diesen Namen werden als Rechnung versucht (Annahme 6),
 * verglichen ohne Groß/Klein. Ein Name mit Pfad davor passt nie.
 */
export const INVOICE_ATTACHMENT_NAMES: readonly string[] = ['factur-x.xml', 'zugferd-invoice.xml', 'ZUGFeRD-invoice.xml', 'xrechnung.xml'];

const LOWER_NAMES = new Set(INVOICE_ATTACHMENT_NAMES.map((n) => n.toLowerCase()));

export function isInvoiceAttachmentName(name: string): boolean {
  return LOWER_NAMES.has(name.toLowerCase());
}

const CII_NAMESPACE = 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100';
const CREDIT_NOTE = '381';

type Node = Record<string, unknown>;

class MissingField extends Error {
  constructor(readonly field: string) {
    super(field);
  }
}

/** Ein Element als Objekt; eine Wiederholung, wo keine sein dürfte, zählt mit ihrem ersten Vorkommen. */
function child(node: unknown, name: string): Node | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const value = (node as Node)[name];
  const first = Array.isArray(value) ? value[0] : value;
  return first && typeof first === 'object' ? (first as Node) : undefined;
}

function list(node: unknown, name: string): unknown[] {
  if (!node || typeof node !== 'object') return [];
  const value = (node as Node)[name];
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

/** Textwert eines Elements, Entitäten einmal aufgelöst; leer gilt als fehlend. */
function textOf(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  const raw = typeof first === 'string' ? first : first && typeof first === 'object' ? (first as Node)['#text'] : undefined;
  if (typeof raw !== 'string') return null;
  const text = decodeXmlEntities(raw).trim();
  return text === '' ? null : text;
}

function text(node: unknown, name: string): string | null {
  return node && typeof node === 'object' ? textOf((node as Node)[name]) : null;
}

function attr(value: unknown, name: string): string | null {
  return value && typeof value === 'object' && typeof (value as Node)[`@_${name}`] === 'string' ? ((value as Node)[`@_${name}`] as string) : null;
}

/**
 * Dezimaltext → Cent, ganzzahlig: "172.50" → 17250, "1234.5" → 123450,
 * "-5" → -500. Mehr als zwei Nachkommastellen werden kaufmännisch gerundet
 * (die dritte Stelle entscheidet, weg von null). `null`, wenn der Text kein
 * Dezimalwert ist — etwa mit Komma.
 */
function parseCents(value: string | null): number | null {
  if (value === null) return null;
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(value);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) return null;
  const fraction = m[3] ?? '';
  const roundUp = fraction.length > 2 && fraction[2]! >= '5' ? 1 : 0;
  const cents = Number(m[2] || '0') * 100 + Number(fraction.slice(0, 2).padEnd(2, '0')) + roundUp;
  if (!Number.isSafeInteger(cents)) return null;
  return m[1] === '-' && cents !== 0 ? -cents : cents;
}

function requiredCents(node: unknown, name: string, field = name): number {
  const cents = parseCents(text(node, name));
  if (cents === null) throw new MissingField(field);
  return cents;
}

/** `udt:DateTimeString` im Format 102 (`YYYYMMDD`) → ISO; alles andere und Nicht-Kalendertage → `null`. */
function dateOf(node: unknown): string | null {
  const value = child(node, 'DateTimeString') ?? (node as Node | undefined)?.DateTimeString;
  const raw = textOf(value);
  const format = attr(Array.isArray(value) ? value[0] : value, 'format');
  if (raw === null || (format !== null && format !== '102')) return null;
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Der Namensraum des Wurzelelements, aus dem Rohtext — `removeNSPrefix` nimmt die Deklarationen mit weg. */
function rootIsCii(xml: string): boolean {
  const root = /<([\w.-]+:)?CrossIndustryInvoice\b([^>]*)>/.exec(xml);
  if (!root) return false;
  const prefix = root[1] ? `:${root[1].slice(0, -1)}` : '';
  return new RegExp(`\\bxmlns${prefix.replace(/[.]/g, '\\.')}\\s*=\\s*["']${CII_NAMESPACE}["']`).test(root[2]!);
}

function readInvoice(root: Node): ParsedInvoice {
  const context = child(root, 'ExchangedDocumentContext');
  const doc = child(root, 'ExchangedDocument');
  const transaction = child(root, 'SupplyChainTradeTransaction');
  if (!transaction) throw new MissingField('SupplyChainTradeTransaction');
  const agreement = child(transaction, 'ApplicableHeaderTradeAgreement');
  const settlement = child(transaction, 'ApplicableHeaderTradeSettlement');
  const summation = child(settlement, 'SpecifiedTradeSettlementHeaderMonetarySummation');

  const invoiceNumber = text(doc, 'ID');
  if (invoiceNumber === null) throw new MissingField('ExchangedDocument/ID');
  const typeCode = text(doc, 'TypeCode');
  if (typeCode === null) throw new MissingField('ExchangedDocument/TypeCode');
  const issueDate = dateOf(child(doc, 'IssueDateTime'));
  if (issueDate === null) throw new MissingField('IssueDateTime');

  const seller = child(agreement, 'SellerTradeParty');
  const sellerName = text(seller, 'Name');
  if (sellerName === null) throw new MissingField('SellerTradeParty/Name');
  const vatRegistration = list(seller, 'SpecifiedTaxRegistration')
    .map((r) => (r && typeof r === 'object' ? (r as Node).ID : undefined))
    .find((id) => attr(id, 'schemeID') === 'VA');
  const sellerVatId = vatRegistration === undefined ? null : textOf(vatRegistration);

  const currency = text(settlement, 'InvoiceCurrencyCode');
  if (currency === null) throw new MissingField('InvoiceCurrencyCode');

  const grandTotalCents = requiredCents(summation, 'GrandTotalAmount');
  const duePayableCents = text(summation, 'DuePayableAmount') === null ? grandTotalCents : requiredCents(summation, 'DuePayableAmount');

  const taxes: InvoiceTax[] = list(settlement, 'ApplicableTradeTax').map((tax) => {
    const rateText = text(tax, 'RateApplicablePercent');
    const ratePercent = rateText === null ? 0 : Number(rateText);
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(rateText ?? '0') || !Number.isFinite(ratePercent)) {
      throw new MissingField('ApplicableTradeTax/RateApplicablePercent');
    }
    return {
      ratePercent,
      categoryCode: text(tax, 'CategoryCode') ?? '',
      basisCents: requiredCents(tax, 'BasisAmount', 'ApplicableTradeTax/BasisAmount'),
      taxCents: requiredCents(tax, 'CalculatedAmount', 'ApplicableTradeTax/CalculatedAmount'),
    };
  });

  // Eine Rechnung kann die Steuer zweimal nennen: in Rechnungs- und in Buchungswährung.
  const taxTotals = list(summation, 'TaxTotalAmount');
  const taxTotal = taxTotals.find((t) => attr(t, 'currencyID') === currency) ?? taxTotals.find((t) => attr(t, 'currencyID') === null) ?? taxTotals[0];
  let taxTotalCents: number;
  if (taxTotal === undefined) {
    taxTotalCents = taxes.reduce((sum, t) => sum + t.taxCents, 0);
  } else {
    const cents = parseCents(textOf(taxTotal));
    if (cents === null) throw new MissingField('TaxTotalAmount');
    taxTotalCents = cents;
  }

  const dueDate = list(settlement, 'SpecifiedTradePaymentTerms').map((terms) => dateOf(child(terms, 'DueDateDateTime'))).find((d) => d !== null) ?? null;
  const iban = list(settlement, 'SpecifiedTradeSettlementPaymentMeans')
    .map((means) => text(child(means, 'PayeePartyCreditorFinancialAccount'), 'IBANID'))
    .find((i) => i !== null);

  const sign = typeCode === CREDIT_NOTE ? -1 : 1;
  const signed = (cents: number) => (cents === 0 ? 0 : sign * cents);

  return {
    profile: text(child(context, 'GuidelineSpecifiedDocumentContextParameter'), 'ID'),
    invoiceNumber,
    issueDate,
    typeCode,
    sellerName,
    sellerVatId,
    buyerName: text(child(agreement, 'BuyerTradeParty'), 'Name'),
    currency,
    grandTotalCents: signed(grandTotalCents),
    duePayableCents: signed(duePayableCents),
    taxTotalCents: signed(taxTotalCents),
    taxes: taxes.map((t) => ({ ...t, basisCents: signed(t.basisCents), taxCents: signed(t.taxCents) })),
    dueDate,
    paymentReference: text(settlement, 'PaymentReference'),
    payeeIban: iban ? iban.replace(/\s+/g, '').toUpperCase() : null,
  };
}

export function parseFacturX(bytes: Uint8Array, opts: { maxBytes?: number } = {}): ParseInvoiceResult {
  const guarded = guardXml(bytes, { maxBytes: opts.maxBytes ?? INVOICE_XML_MAX_BYTES });
  if (!guarded.ok) {
    const code = guarded.code === 'tooLarge' ? 'xmlTooLarge' : guarded.code === 'notXml' ? 'xmlInvalid' : 'doctypeRefused';
    return { ok: false, code };
  }

  let parsed: Node;
  try {
    parsed = secureXmlParser({
      arrays: ['SpecifiedTaxRegistration', 'ApplicableTradeTax', 'SpecifiedTradeSettlementPaymentMeans', 'SpecifiedTradePaymentTerms', 'TaxTotalAmount'],
    }).parse(guarded.text) as Node;
  } catch {
    return { ok: false, code: 'xmlInvalid' };
  }

  const root = child(parsed, 'CrossIndustryInvoice');
  if (!root || !rootIsCii(guarded.text)) return { ok: false, code: 'notAnInvoice' };

  try {
    return { ok: true, invoice: readInvoice(root) };
  } catch (error) {
    if (error instanceof MissingField) return { ok: false, code: 'missingField', field: error.field };
    return { ok: false, code: 'xmlInvalid' };
  }
}
