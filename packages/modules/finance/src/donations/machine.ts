import { documentImageExtension, isoNow, newId, notFound, ok, readSetting, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { checksumOf, createDraft, type DocumentRecord } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict } from '../errors';
import { requireFinanceRead } from '../ledger/access';
import { machineStatusOf, periodsOverlap, type MachineProcedureMissing } from '../ledger/machine-status';
import { financeNotices, financeSigners, type FinanceSignerRow } from '../schema';
import { germanDate } from './templates/shared';
import { notificationLetter } from './templates/wording';

/**
 * Maschinelles Verfahren (F6a Task 4, Spec 7.2, Annahme 8; R 10b.1 Abs. 4
 * EStR): eine Reihe von Unterzeichnern mit taggenauem Zeitraum, je einer mit
 * Faksimile im Modulspeicher `finance` und dem Tag der Anzeige beim
 * Finanzamt. Das Faksimile liegt nie in der Mediathek, nie im Protokoll, nie
 * über MCP — gelesen wird es nur über den Route Handler der Bescheid-Seite
 * (`readFacsimile`) und intern beim Ausstellen (`readFacsimileInternal`).
 */
export interface SignerView {
  id: string;
  validFrom: string;
  validTo: string | null;
  signerName: string;
  hasFacsimile: boolean;
  facsimileChecksum: string | null;
  notifiedOn: string | null;
  state: 'current' | 'past' | 'future';
}

export interface MachineProcedureStatus {
  complete: boolean;
  signer: SignerView | null;
  missing: MachineProcedureMissing[];
}

/** Obergrenze eines Faksimiles: 1 MB. */
export const FACSIMILE_MAX_BYTES = 1024 * 1024;

type FacsimileExtension = 'png' | 'jpg';
const MIME: Record<FacsimileExtension, 'image/png' | 'image/jpeg'> = { png: 'image/png', jpg: 'image/jpeg' };

/** Der Schlüssel im Modulspeicher. Klein geschrieben: Der Dateispeicher nimmt nur `[a-z0-9._-]` (die ULID ist groß). */
export function facsimileKeyFor(signerId: string, ext: FacsimileExtension): string {
  return `signature-${signerId.toLowerCase()}.${ext}`;
}

const today = (deps: Deps) => isoNow(deps.clock).slice(0, 10);

function toView(row: FinanceSignerRow, date: string): SignerView {
  const state: SignerView['state'] = row.validFrom > date ? 'future' : row.validTo !== null && row.validTo < date ? 'past' : 'current';
  return {
    id: row.id,
    validFrom: row.validFrom,
    validTo: row.validTo,
    signerName: row.signerName,
    hasFacsimile: row.facsimileKey !== null,
    facsimileChecksum: row.facsimileChecksum,
    notifiedOn: row.notifiedOn,
    state,
  };
}

const allSigners = (db: DbOrTx) => db.select().from(financeSigners).all();

/** Vollständig nur mit einem am Tag gültigen Unterzeichner, Faksimile und Anzeige — für die Bestätigung (Task 5) und die Checkliste. */
export function machineProcedureStatusAt(db: DbOrTx, date: string): MachineProcedureStatus {
  const { signer, missing } = machineStatusOf(allSigners(db), date);
  return { complete: missing.length === 0, signer: signer ? toView(signer, date) : null, missing };
}

const auditFields = (row: FinanceSignerRow) => ({ validFrom: row.validFrom, validTo: row.validTo, hasFacsimile: row.facsimileKey !== null, notifiedOn: row.notifiedOn });

const isoDate = z.iso.date();

const saveSignerSchema = z
  .object({
    id: z.string().min(1).optional(),
    validFrom: isoDate,
    validTo: isoDate.nullable().optional(),
    signerName: z.string().trim().min(1).max(200),
    notifiedOn: isoDate.nullable().optional(),
  })
  .superRefine((v, c) => {
    if (v.validTo && v.validTo < v.validFrom) c.addIssue({ code: 'custom', path: ['validTo'], message: 'beforeValidFrom' });
  });

/**
 * Unterzeichner anlegen oder ändern — `finance.donationsIssue`. Zeiträume
 * überschneiden sich nie (`signerOverlaps`); eine Amtsübergabe setzt zuerst
 * das Ende des bisherigen (F10a ruft dasselbe). Der Name steht am Datensatz,
 * nie im Protokoll.
 */
export async function saveSigner(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<SignerView>> {
  const denied = requirePermission(ctx, 'finance.donationsIssue');
  if (denied) return denied;
  const parsed = validate(deps, saveSignerSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  const before = v.id ? deps.db.select().from(financeSigners).where(eq(financeSigners.id, v.id)).get() : undefined;
  if (v.id && !before) return notFound('financeSigner', v.id);

  const period = { validFrom: v.validFrom, validTo: v.validTo ?? null };
  if (allSigners(deps.db).some((other) => other.id !== v.id && periodsOverlap(period, other))) return financeConflict('signerOverlaps');

  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    const id = before?.id ?? newId();
    const fields = { ...period, signerName: v.signerName, notifiedOn: v.notifiedOn ?? null, updatedAt: now };
    if (before) tx.update(financeSigners).set(fields).where(eq(financeSigners.id, id)).run();
    else tx.insert(financeSigners).values({ id, ...fields, facsimileKey: null, facsimileChecksum: null, createdAt: now, createdByUserId: ctx.userId ?? 'system' }).run();
    const after = tx.select().from(financeSigners).where(eq(financeSigners.id, id)).get()!;
    financeAudit(tx, deps, ctx, { action: 'finance.signer.save', entity: 'financeSigner', id, before: before ? auditFields(before) : undefined, after: auditFields(after), summary: `Unterzeichner ${id} ${before ? 'geändert' : 'angelegt'}` });
    return ok(toView(after, today(deps)));
  });
}

const uploadSchema = z.object({
  signerId: z.string().min(1),
  bytes: z.instanceof(Uint8Array),
  /** Was der Browser behauptet — geglaubt wird nur den ersten Bytes. */
  mimeType: z.string().max(100).optional(),
});

/**
 * Faksimile hochladen — `finance.donationsIssue`. PNG oder JPEG nach den
 * ersten Bytes (nie nach `mimeType`), höchstens 1 MB. Liegt unter
 * `signature-<id>.<png|jpg>` im Modulspeicher; ein früheres Faksimile wird
 * gelöscht. Ins Protokoll kommt nur `hasFacsimile` — weder Bytes noch
 * Prüfsumme noch Name.
 */
export async function uploadFacsimile(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<SignerView>> {
  const denied = requirePermission(ctx, 'finance.donationsIssue');
  if (denied) return denied;
  const parsed = validate(deps, uploadSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  const before = deps.db.select().from(financeSigners).where(eq(financeSigners.id, v.signerId)).get();
  if (!before) return notFound('financeSigner', v.signerId);

  const ext = documentImageExtension(v.bytes);
  if (!ext) return financeConflict('facsimileNotImage');
  if (v.bytes.byteLength > FACSIMILE_MAX_BYTES) return financeConflict('facsimileTooLarge');

  const key = facsimileKeyFor(before.id, ext);
  const checksum = checksumOf(v.bytes);
  const store = deps.files('finance');
  // Der Speicher überschreibt nie (`wx`): Bei gleicher Endung muss die alte Datei zuerst weichen.
  if (before.facsimileKey === key) await store.delete(key);
  await store.write(key, v.bytes);
  let after: FinanceSignerRow;
  try {
    after = deps.db.transaction((tx: DbOrTx) => {
      tx.update(financeSigners).set({ facsimileKey: key, facsimileChecksum: checksum, updatedAt: isoNow(deps.clock) }).where(eq(financeSigners.id, before.id)).run();
      financeAudit(tx, deps, ctx, { action: 'finance.signer.facsimile', entity: 'financeSigner', id: before.id, after: { hasFacsimile: true }, summary: `Faksimile für Unterzeichner ${before.id} hinterlegt` });
      return tx.select().from(financeSigners).where(eq(financeSigners.id, before.id)).get()!;
    });
  } catch (error) {
    if (before.facsimileKey !== key) await store.delete(key);
    throw error;
  }
  if (before.facsimileKey && before.facsimileKey !== key) await store.delete(before.facsimileKey);
  return ok(toView(after, today(deps)));
}

/**
 * Die Bytes des Faksimiles samt Prüfsumme und Typ — für `issueConfirmation`
 * (Task 5), das sie der Vorlage als `images.signature` gibt. Ohne Faksimile
 * `null`. Weicht die Prüfsumme ab, ist die Datei beschädigt: ein technischer
 * Fehler, keine Fachfrage.
 */
export async function readFacsimileInternal(deps: Deps, signer: Pick<FinanceSignerRow, 'id' | 'facsimileKey' | 'facsimileChecksum'>): Promise<{ bytes: Uint8Array; checksum: string; mimeType: 'image/png' | 'image/jpeg' } | null> {
  if (!signer.facsimileKey || !signer.facsimileChecksum) return null;
  const bytes = new Uint8Array(await deps.files('finance').read(signer.facsimileKey));
  if (checksumOf(bytes) !== signer.facsimileChecksum) throw new Error(`facsimile checksum mismatch for signer ${signer.id}`);
  const ext = documentImageExtension(bytes);
  if (!ext) throw new Error(`facsimile of signer ${signer.id} is no image`);
  return { bytes, checksum: signer.facsimileChecksum, mimeType: MIME[ext] };
}

const readSchema = z.object({ signerId: z.string().min(1) });

/** Das Faksimile als Bytes — `finance.donationsIssue`, nur für den Route Handler. **Kein MCP-Werkzeug**: Eine Unterschrift gehört nie in den Modellkontext. */
export async function readFacsimile(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ bytes: Uint8Array; mimeType: 'image/png' | 'image/jpeg' }>> {
  const denied = requirePermission(ctx, 'finance.donationsIssue');
  if (denied) return denied;
  const parsed = validate(deps, readSchema, input);
  if (!parsed.ok) return parsed;
  const signer = deps.db.select().from(financeSigners).where(eq(financeSigners.id, parsed.value.signerId)).get();
  if (!signer) return notFound('financeSigner', parsed.value.signerId);
  const facsimile = await readFacsimileInternal(deps, signer);
  if (!facsimile) return notFound('financeSignerFacsimile', signer.id);
  return ok({ bytes: facsimile.bytes, mimeType: facsimile.mimeType });
}

/** Alle Unterzeichner (jüngster Beginn zuerst) und der Stand heute — `finance.read`. Der Speicherschlüssel bleibt drinnen. */
export async function getMachineProcedure(deps: Deps, ctx: CallContext): Promise<Result<{ signers: SignerView[]; status: MachineProcedureStatus }>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const date = today(deps);
  const signers = [...allSigners(deps.db)].sort((a, b) => b.validFrom.localeCompare(a.validFrom)).map((row) => toView(row, date));
  return ok({ signers, status: machineProcedureStatusAt(deps.db, date) });
}

const letterSchema = z.object({ signerId: z.string().min(1) });

/**
 * Das Anzeigeschreiben als **Entwurf der Akte** (Art „Brief“) —
 * `finance.donationsIssue` **und** `dms.create`. Fehlt `dms.create`, kommt
 * `forbidden` mit diesem Recht zurück; die Oberfläche nennt dann, wer es hat
 * (`listUserNamesWithPermission`). Empfänger ist das Finanzamt des jüngsten
 * nicht irrtümlich erfassten Bescheids — nur sein Name, im Text: Die Akte
 * kennt Empfänger nur als Kontakt, und die Anschrift kennt Kompass nicht.
 * Der Betreff nennt weder Finanzamt, Steuernummer noch Namen, weil er ins
 * Protokoll der Akte geht.
 */
export async function createNotificationLetterDraft(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DocumentRecord>> {
  const denied = requirePermission(ctx, 'finance.donationsIssue') ?? requirePermission(ctx, 'dms.create');
  if (denied) return denied;
  const parsed = validate(deps, letterSchema, input);
  if (!parsed.ok) return parsed;
  const signer = deps.db.select().from(financeSigners).where(eq(financeSigners.id, parsed.value.signerId)).get();
  if (!signer) return notFound('financeSigner', parsed.value.signerId);

  const notice = deps.db.select().from(financeNotices).all().filter((n) => n.voidedAt === null).sort((a, b) => b.noticeDate.localeCompare(a.noticeDate) || b.createdAt.localeCompare(a.createdAt)).at(0);
  if (!notice) return financeConflict('noNoticeValidAt', { date: today(deps) });

  const body = notificationLetter(signer.signerName, signer.notifiedOn ? germanDate(signer.notifiedOn) : null, {
    organizationName: readSetting<string>(deps, 'organization.name'),
    taxOffice: notice.taxOffice,
    taxNumber: notice.taxNumber,
  });
  return createDraft(deps, ctx, { typeKey: 'letter', subject: 'Anzeige: maschinell erstellte Zuwendungsbestätigungen', body });
}
