import { ok, readSetting, requirePermission, validate, type CallContext, type Deps, type Result } from '@kompass/core';
import { and, eq, or } from 'drizzle-orm';
import { z } from 'zod';
import { financeConflict } from '../errors';
import { formatIban, normalizeIban } from '../ledger/iban';
import { financeAccounts, type FinanceAccountRow } from '../schema';
import { camtStatementIbans } from './camt';
import { decodeCsv, guessCsvFormat, headerSignature, tokenizeCsv, type CsvFormat } from './csv';
import { activeProfileInternal, profileFormatInternal } from './profiles';
import { importedThroughInternal } from './queries';
import { looksLikeXml } from './runs';

/** Ein Konto, das zu einem Auszug passt — für die Auswahl im Zwischenschritt (Name · Format · „importiert bis“). */
export interface DetectedAccount {
  accountId: string;
  name: string;
  /** CSV: der Name des aktiven Formats; CAMT: `CAMT.053`. */
  formatLabel: string;
  importedThrough: string | null;
}

/**
 * Welches Konto zu einem Auszug gehört (Design-Nachtrag N3, W-1). `one`:
 * ohne Rückfrage laden. `many`/`none`: der Zwischenschritt der Oberfläche.
 * `unreadable`: nicht einmal Kopf oder IBAN lesbar — `code` ist der
 * Lesefehler von `parseCamt053`.
 */
export type DetectedStatement =
  | { kind: 'one'; format: 'camt053' | 'csv'; accountId: string }
  | { kind: 'many'; format: 'camt053' | 'csv'; accounts: DetectedAccount[] }
  | { kind: 'none'; format: 'camt053' | 'csv'; /** CAMT: die fremde IBAN. */ iban: string | null; /** CSV: die Signatur der erratenen Kopfzeile. */ headerSignature: string | null }
  | { kind: 'unreadable'; code: string };

const detectSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  bytes: z.custom<Uint8Array>((v) => v instanceof Uint8Array, { message: 'invalidBytes' }),
});

const CAMT_LABEL = 'CAMT.053';

function importableAccounts(deps: Deps): FinanceAccountRow[] {
  return deps.db
    .select()
    .from(financeAccounts)
    .where(and(eq(financeAccounts.isActive, true), or(eq(financeAccounts.kind, 'bank'), eq(financeAccounts.kind, 'paymentService'))))
    .all();
}

function toDetected(deps: Deps, format: 'camt053' | 'csv', hits: { account: FinanceAccountRow; formatLabel: string }[]): DetectedStatement {
  if (hits.length === 1) return { kind: 'one', format, accountId: hits[0]!.account.id };
  return {
    kind: 'many',
    format,
    accounts: hits.map(({ account, formatLabel }) => ({ accountId: account.id, name: account.name, formatLabel, importedThrough: importedThroughInternal(deps.db, account.id) })),
  };
}

/** Die Kopfzeile, wie ein Format sie liest: mit seinem Zeichensatz, Trennzeichen und seiner Kopfzeilen-Nummer. */
function headerAt(bytes: Uint8Array, format: Pick<CsvFormat, 'encoding' | 'delimiter' | 'headerRow'>): string | null {
  const header = tokenizeCsv(decodeCsv(bytes, format.encoding), format.delimiter)[format.headerRow];
  return header ? headerSignature(header) : null;
}

/**
 * Das Konto eines Auszugs erkennen (N3, W-1): CAMT an der IBAN aller `Stmt`,
 * CSV an der Kopfzeilen-Signatur gegen das aktive Format jedes Kontos (jedes
 * Konto hat genau eins). Nur aktive Bank- und Zahlungsdienstkonten. Legt
 * keinen Lauf an und schreibt nichts ins Änderungsprotokoll — Laden bleibt
 * `importStatement` mit der `accountId`. `finance.entriesWrite` wie das
 * Laden selbst.
 *
 * Eine CAMT-Datei mit Auszügen für verschiedene IBANs wird abgelehnt
 * (`statementMultipleAccounts`), nicht zur Auswahl gestellt: Ein Lauf gehört
 * zu einem Konto, und keine Wahl wäre für die ganze Datei richtig.
 */
export async function detectStatementAccount(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DetectedStatement>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, detectSchema, input);
  if (!parsed.ok) return parsed;
  const { bytes } = parsed.value;

  const uploadLimitMb = readSetting<number>(deps, 'finance.uploadLimitMb');
  const maxBytes = uploadLimitMb * 1024 * 1024;
  if (bytes.byteLength > maxBytes) return financeConflict('statementTooLarge', { limit: String(uploadLimitMb) });

  const accounts = importableAccounts(deps);

  if (looksLikeXml(bytes)) {
    const read = camtStatementIbans(bytes, { maxBytes });
    if (!read.ok) return ok({ kind: 'unreadable', code: read.error.code });
    const ibans = [...new Set(read.ibans.map(normalizeIban))];
    if (ibans.length > 1) return financeConflict('statementMultipleAccounts', { ibans: ibans.map(formatIban).join(', ') });
    const iban = ibans[0]!;
    const hits = accounts.filter((a) => a.iban !== null && normalizeIban(a.iban) === iban).map((account) => ({ account, formatLabel: CAMT_LABEL }));
    if (hits.length === 0) return ok({ kind: 'none', format: 'camt053', iban, headerSignature: null });
    return ok(toDetected(deps, 'camt053', hits));
  }

  const hits: { account: FinanceAccountRow; formatLabel: string }[] = [];
  for (const account of accounts) {
    if (account.importFormat !== 'csv') continue;
    const profile = activeProfileInternal(deps.db, account);
    if (!profile) continue;
    if (headerAt(bytes, profileFormatInternal(profile)) === profile.headerSignature) hits.push({ account, formatLabel: profile.name });
  }
  if (hits.length === 0) return ok({ kind: 'none', format: 'csv', iban: null, headerSignature: headerSignature(guessCsvFormat(bytes).header) });
  return ok(toDetected(deps, 'csv', hits));
}
