import { decodeXmlEntities, guardXml, secureXmlParser } from './xml';

/**
 * Der reine Leser eines CAMT.053-Kontoauszugs (Spec 6.2). Keine Datenbank,
 * kein `deps`, keine Uhr — Bytes hinein, ein Auszug mit Zeilen oder ein
 * genannter Lesefehler heraus. Sicherheit zuerst, auf dem dekodierten Text,
 * vor jedem Parserlauf: Größenlimit, `<!DOCTYPE`/`<!ENTITY` verboten, nur
 * UTF-8/UTF-16 mit BOM-Erkennung — gemeinsam mit dem ZUGFeRD-Leser in
 * `./xml.ts` (`guardXml`, `secureXmlParser` mit `processEntities: false`).
 */

export interface CamtLine {
  /** Laufende Nummer in der Datei, ab 1 — für Fehlermeldungen. Über die ganze Datei hinweg fortlaufend, nicht je Auszug. */
  index: number;
  bookingDate: string;
  valueDate: string | null;
  /** Eingang +, Ausgang − (CdtDbtInd). */
  amountCents: number;
  counterpartyName: string | null;
  counterpartyIban: string | null;
  /** Ustrd zusammengefügt, Leerraum normalisiert; leer = ''. */
  purpose: string;
  /** AcctSvcrRef der TxDtls, sonst des Ntry. */
  bankReference: string | null;
  endToEndId: string | null;
  /** RtrInf/Rsn/Cd — „zurückgegebene Zahlung“. */
  returnCode: string | null;
  /** Sts ≠ BOOK. */
  pending: boolean;
}

export interface CamtStatement {
  iban: string;
  currency: 'EUR';
  from: string;
  to: string;
  openingCents: number;
  closingCents: number;
  lines: CamtLine[];
  version: '001.02' | '001.08';
}

export type CamtError = {
  code: 'notXml' | 'doctypeRefused' | 'tooLarge' | 'notCamt053' | 'unsupportedVersion' | 'currencyNotEur' | 'noIban' | 'noBalances' | 'lineUnreadable' | 'sumMismatch';
  line?: number;
  detail?: string;
};

type ParseResult = { ok: true; statements: CamtStatement[] } | { ok: false; error: CamtError };

const NAMESPACE_VERSIONS: Record<string, '001.02' | '001.08'> = {
  'urn:iso:std:iso:20022:tech:xsd:camt.053.001.02': '001.02',
  'urn:iso:std:iso:20022:tech:xsd:camt.053.001.08': '001.08',
};

function fail(code: CamtError['code'], extra?: Partial<Omit<CamtError, 'code'>>): { ok: false; error: CamtError } {
  return { ok: false, error: { code, ...extra } };
}

/** Ganzzahl-Arithmetik aus dem Text — "1234.56" → 123456. Nie `parseFloat`. `null`, wenn der Text nicht lesbar ist. */
function parseAmountCents(text: string): number | null {
  const match = /^(\d+)\.(\d{1,2})$/.exec(text.trim());
  if (!match) return null;
  const [, whole, fraction] = match as unknown as [string, string, string];
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Ustrd kann eine Zeichenkette oder mehrere (Array) sein — zusammengefügt, Leerraum normalisiert. */
function joinUstrd(value: unknown): string {
  if (value === undefined || value === null) return '';
  const parts = Array.isArray(value) ? value : [value];
  return parts
    .map((p) => decodeXmlEntities(textOf(p) ?? ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ein Feld ist entweder eine einfache Zeichenkette oder — je nach Fassung — ein `{ Cd: … }`/`{ '#text': … }`-Objekt. */
function textOf(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.Cd === 'string') return obj.Cd;
    if (typeof obj['#text'] === 'string') return obj['#text'];
  }
  return null;
}

function dateOf(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const obj = value as Record<string, unknown>;
  const dt = obj.Dt ?? obj.DtTm;
  if (typeof dt === 'string') return dt.slice(0, 10);
  return null;
}

interface RawTx {
  amountText?: string;
  bankReference: string | null;
  endToEndId: string | null;
  counterpartyName: string | null;
  counterpartyIban: string | null;
  purpose: string;
  returnCode: string | null;
}

/** Ein Textwert für Menschen oder Abgleich: vordefinierte Entitäten aufgelöst (der Parser läuft ohne, `./xml.ts`). */
function decoded(value: string | null): string | null {
  return value === null ? null : decodeXmlEntities(value);
}

function readTxDtls(node: Record<string, unknown>, direction: 'CRDT' | 'DBIT'): RawTx {
  const refs = (node.Refs ?? {}) as Record<string, unknown>;
  const partyTag = direction === 'CRDT' ? 'Dbtr' : 'Cdtr';
  const acctTag = direction === 'CRDT' ? 'DbtrAcct' : 'CdtrAcct';
  const rltdPties = (node.RltdPties ?? {}) as Record<string, unknown>;
  const party = rltdPties[partyTag] as Record<string, unknown> | undefined;
  const acct = rltdPties[acctTag] as Record<string, unknown> | undefined;
  const rtrInf = node.RtrInf as Record<string, unknown> | undefined;
  const amt = node.Amt as Record<string, unknown> | string | undefined;
  return {
    amountText: typeof amt === 'string' ? amt : typeof amt === 'object' ? textOf(amt) ?? undefined : undefined,
    bankReference: typeof refs.AcctSvcrRef === 'string' ? decodeXmlEntities(refs.AcctSvcrRef) : null,
    // `NOTPROVIDED` ist der CAMT-Platzhalter für „keine Referenz“ — als Referenz geführt, hielte die Dubletten-Erkennung fremde Zeilen für gleich.
    endToEndId: typeof refs.EndToEndId === 'string' && refs.EndToEndId.trim() !== 'NOTPROVIDED' ? decodeXmlEntities(refs.EndToEndId) : null,
    counterpartyName: party && typeof party.Nm === 'string' ? decodeXmlEntities(party.Nm) : null,
    counterpartyIban: acct ? textOf((acct.Id as Record<string, unknown> | undefined)?.IBAN) : null,
    purpose: joinUstrd((node.RmtInf as Record<string, unknown> | undefined)?.Ustrd),
    returnCode: rtrInf ? textOf((rtrInf.Rsn as Record<string, unknown> | undefined)?.Cd) : null,
  };
}

export function parseCamt053(bytes: Uint8Array, opts: { maxBytes: number }): ParseResult {
  const guarded = guardXml(bytes, opts);
  if (!guarded.ok) return fail(guarded.code);
  const text = guarded.text;

  const parser = secureXmlParser({ arrays: ['Stmt', 'Ntry', 'TxDtls', 'Bal'] });

  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(text) as Record<string, unknown>;
  } catch {
    return fail('notXml');
  }

  const root = parsed.Document as Record<string, unknown> | undefined;
  if (!root || typeof root !== 'object') return fail('notXml');

  const bkToCstmrStmt = root.BkToCstmrStmt as Record<string, unknown> | undefined;
  if (!bkToCstmrStmt) return fail('notCamt053');

  // `removeNSPrefix` strips the `xmlns`-Deklaration selbst mit weg (sie ist
  // ja ein Namensraum-Präfix); der Namensraum kommt deshalb direkt aus dem
  // Rohtext des Wurzelelements — auch bei einem präfigierten `<ns:Document>`.
  const namespaceMatch = /<(?:\w+:)?Document\b[^>]*\bxmlns(?::\w+)?="([^"]+)"/i.exec(text);
  const namespace = namespaceMatch?.[1];
  const version = namespace ? NAMESPACE_VERSIONS[namespace] : undefined;
  if (!version) return fail('unsupportedVersion');

  const stmtNodes = (bkToCstmrStmt.Stmt ?? []) as Record<string, unknown>[];
  const statements: CamtStatement[] = [];
  let lineIndex = 1;

  for (const stmt of stmtNodes) {
    const acct = stmt.Acct as Record<string, unknown> | undefined;
    const iban = textOf((acct?.Id as Record<string, unknown> | undefined)?.IBAN);
    if (!iban) return fail('noIban');

    const currency = typeof acct?.Ccy === 'string' ? acct.Ccy : null;
    if (currency !== 'EUR') return fail('currencyNotEur');

    const bals = (stmt.Bal ?? []) as Record<string, unknown>[];
    const findBal = (codes: string[]) =>
      bals.find((b) => codes.includes(textOf((b.Tp as Record<string, unknown> | undefined)?.CdOrPrtry ?? (b.Tp as Record<string, unknown> | undefined)?.Cd) ?? ''));
    const opening = findBal(['OPBD', 'PRCD']);
    const closing = findBal(['CLBD']);
    if (!opening || !closing) return fail('noBalances');

    const signedBalance = (bal: Record<string, unknown>): number | null => {
      const cents = parseAmountCents(textOf(bal.Amt) ?? '');
      if (cents === null) return null;
      return bal.CdtDbtInd === 'DBIT' ? -cents : cents;
    };
    const openingCents = signedBalance(opening);
    const closingCents = signedBalance(closing);
    if (openingCents === null || closingCents === null) return fail('lineUnreadable', { line: lineIndex });

    const from = dateOf(opening.Dt) ?? '';
    const to = dateOf(closing.Dt) ?? '';

    const lines: CamtLine[] = [];
    let bookedSum = 0;

    for (const ntry of (stmt.Ntry ?? []) as Record<string, unknown>[]) {
      const direction = ntry.CdtDbtInd === 'DBIT' ? 'DBIT' : 'CRDT';
      const sign = direction === 'DBIT' ? -1 : 1;
      const statusCode = textOf(ntry.Sts) ?? 'BOOK';
      const pending = statusCode !== 'BOOK';
      const bookingDate = dateOf(ntry.BookgDt) ?? '';
      const valueDate = dateOf(ntry.ValDt);
      const entryAcctSvcrRef = decoded(typeof ntry.AcctSvcrRef === 'string' ? ntry.AcctSvcrRef : null);
      const entryReturnCode = textOf((ntry.RtrInf as Record<string, unknown> | undefined)?.Rsn as Record<string, unknown> | undefined) ?? textOf(((ntry.RtrInf as Record<string, unknown> | undefined)?.Rsn as Record<string, unknown> | undefined)?.Cd);
      const entryAmount = parseAmountCents(textOf(ntry.Amt) ?? '');
      if (entryAmount === null) return fail('lineUnreadable', { line: lineIndex });

      const txDtlsList = ((ntry.NtryDtls as Record<string, unknown> | undefined)?.TxDtls ?? []) as Record<string, unknown>[];
      const txs = txDtlsList.length > 0 ? txDtlsList.map((t) => readTxDtls(t, direction)) : [readTxDtls({}, direction)];

      const resolvedTxs = txs.map((tx) => {
        const amountText = tx.amountText ?? (txs.length === 1 ? textOf(ntry.Amt) ?? undefined : undefined);
        const amountCents = amountText !== undefined ? parseAmountCents(amountText) : null;
        return { tx, amountCents };
      });
      if (resolvedTxs.some((r) => r.amountCents === null)) return fail('lineUnreadable', { line: lineIndex });

      if (resolvedTxs.length > 1) {
        const sum = resolvedTxs.reduce((s, r) => s + (r.amountCents as number), 0);
        if (sum !== entryAmount) return fail('sumMismatch', { line: lineIndex });
      }

      for (const { tx, amountCents } of resolvedTxs) {
        const cents = resolvedTxs.length === 1 ? entryAmount : (amountCents as number);
        const line: CamtLine = {
          index: lineIndex,
          bookingDate,
          valueDate,
          amountCents: sign * cents,
          counterpartyName: tx.counterpartyName,
          counterpartyIban: tx.counterpartyIban,
          purpose: tx.purpose,
          bankReference: tx.bankReference ?? entryAcctSvcrRef,
          endToEndId: tx.endToEndId,
          returnCode: tx.returnCode ?? entryReturnCode,
          pending,
        };
        lines.push(line);
        if (!pending) bookedSum += line.amountCents;
        lineIndex += 1;
      }
    }

    if (openingCents + bookedSum !== closingCents) return fail('sumMismatch');

    statements.push({ iban, currency: 'EUR', from, to, openingCents, closingCents, lines, version });
  }

  return { ok: true, statements };
}
