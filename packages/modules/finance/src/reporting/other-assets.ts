import { expectedVersionField, invalid, isoNow, newId, notFound, ok, requirePermission, staleVersion, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { and, asc, eq, gte, isNotNull, isNull, lte, or } from 'drizzle-orm';
import { z } from 'zod';
import { checkPickedDocument } from '../allocation/reserves';
import { financeAudit } from '../audit';
import { financeConflict } from '../errors';
import { requireFinanceRead } from '../ledger/access';
import { financeOtherAssets, type FinanceOtherAssetRow } from '../schema';

/**
 * Sonstige Vermögensgegenstände und Verpflichtungen (Spec Rechenschaft 0.4.0 § Kernberichte, Vermögensübersicht;
 * Designer Runde 2 11d–11h): Einträge von Hand mit Bezeichnung, Wert, Grundlage und Beleg, gültig von–bis. Die
 * Berichte lesen sie zum Stichtag (`otherAssetsAtInternal`), nachrichtlich, nie in den Beständen. Bezeichnung,
 * Grundlage und Grund sind frei getippt und stehen nie im Protokoll.
 */

export interface OtherAssetView {
  id: string;
  kind: 'asset' | 'liability';
  label: string;
  valueCents: number;
  basis: string;
  recordedFrom: string;
  recordedUntil: string | null;
  endReason: string | null;
  replacedById: string | null;
  replacesId: string | null;
  documentId: string | null;
  /** Für `expectedVersion` beim Bearbeiten. */
  updatedAt: string;
}

const load = (db: DbOrTx, id: string): FinanceOtherAssetRow | null => db.select().from(financeOtherAssets).where(eq(financeOtherAssets.id, id)).get() ?? null;

function toView(db: DbOrTx, row: FinanceOtherAssetRow): OtherAssetView {
  const predecessor = db.select({ id: financeOtherAssets.id }).from(financeOtherAssets).where(eq(financeOtherAssets.replacedById, row.id)).get();
  return {
    id: row.id, kind: row.kind, label: row.label, valueCents: row.valueCents, basis: row.basis, recordedFrom: row.recordedFrom, recordedUntil: row.recordedUntil,
    endReason: row.endReason, replacedById: row.replacedById, replacesId: predecessor?.id ?? null, documentId: row.documentId, updatedAt: row.updatedAt,
  };
}

const auditFields = (row: FinanceOtherAssetRow) => ({ kind: row.kind, valueCents: row.valueCents, recordedFrom: row.recordedFrom, recordedUntil: row.recordedUntil });

/** Der Vortag eines Tages (`YYYY-MM-DD`), kalendarisch. */
export function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Die am Tag gültigen Einträge: begonnen am oder vor dem Tag, nicht vor ihm beendet. `recordedUntil` ist der
 * letzte Tag, an dem der Gegenstand dem Verein gehörte (11g) — an ihm zählt er noch mit; so hat „Neuer Wert ab …“
 * an jedem Tag genau einen gültigen Eintrag. Rein, ohne Rechteprüfung, Art und Bezeichnung als Reihenfolge.
 */
export function otherAssetsAtInternal(db: DbOrTx, date: string): OtherAssetView[] {
  return db
    .select()
    .from(financeOtherAssets)
    .where(and(lte(financeOtherAssets.recordedFrom, date), or(isNull(financeOtherAssets.recordedUntil), gte(financeOtherAssets.recordedUntil, date))))
    .orderBy(asc(financeOtherAssets.kind), asc(financeOtherAssets.label), asc(financeOtherAssets.id))
    .all()
    .map((row) => toView(db, row));
}

const listSchema = z.object({ date: z.iso.date().optional(), ended: z.boolean().optional() }).strict();

/**
 * `finance.overview`: mit `date` die an dem Tag gültigen Einträge (wie ein Bericht zu diesem Stichtag), mit
 * `ended: true` die beendeten, ohne beides alle.
 */
export async function listOtherAssets(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ items: OtherAssetView[] }>> {
  const denied = requireFinanceRead(ctx, 'overview');
  if (denied) return denied;
  const parsed = validate(deps, listSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const { date, ended } = parsed.value;
  if (date) return ok({ items: otherAssetsAtInternal(deps.db, date) });
  const rows = deps.db
    .select()
    .from(financeOtherAssets)
    .where(ended ? isNotNull(financeOtherAssets.recordedUntil) : undefined)
    .orderBy(asc(financeOtherAssets.kind), asc(financeOtherAssets.label), asc(financeOtherAssets.recordedFrom))
    .all();
  return ok({ items: rows.map((row) => toView(deps.db, row)) });
}

const label = z.string().trim().min(1).max(120);
const basis = z.string().trim().min(1).max(500);
const cents = z.number().int().min(0);

const saveSchema = z.object({
  id: z.string().min(1).optional(),
  expectedVersion: expectedVersionField,
  kind: z.enum(['asset', 'liability']),
  label,
  valueCents: cents,
  basis,
  recordedFrom: z.iso.date(),
  /** Beleg aus der Akte (Rechnung, Schätzung, Vertrag) — festgeschrieben, nicht widerrufen. */
  documentId: z.string().min(1).nullable().optional(),
});

/**
 * `finance.entriesWrite`: anlegen (ohne `id`) oder bearbeiten. Bearbeiten ist für Korrekturen gedacht —
 * festgeschriebene Berichte behalten ihren Stand (Hash); ein neuer Wert ab einem Tag geht über
 * `revalueOtherAsset`. Ein beendeter Eintrag bleibt, wie er war.
 */
export async function saveOtherAsset(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<OtherAssetView>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, saveSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const before = v.id ? load(deps.db, v.id) : null;
  if (v.id && !before) return notFound('financeOtherAsset', v.id);
  if (before) {
    const stale = staleVersion(v.expectedVersion, before.updatedAt);
    if (stale) return stale;
    if (before.recordedUntil !== null) return financeConflict('otherAssetEnded');
  }
  const documentId = v.documentId ?? null;
  if (documentId && documentId !== before?.documentId) {
    const problem = await checkPickedDocument(deps, ctx, documentId);
    if (problem) return problem;
  }
  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    const id = before?.id ?? newId();
    const fields = { kind: v.kind, label: v.label, valueCents: v.valueCents, basis: v.basis, recordedFrom: v.recordedFrom, documentId };
    if (before) tx.update(financeOtherAssets).set({ ...fields, updatedAt: now }).where(eq(financeOtherAssets.id, id)).run();
    else tx.insert(financeOtherAssets).values({ id, ...fields, recordedUntil: null, endReason: null, replacedById: null, createdAt: now, updatedAt: now }).run();
    const after = load(tx, id)!;
    financeAudit(tx, deps, ctx, { action: 'finance.otherAsset.save', entity: 'financeOtherAsset', id, before: before ? auditFields(before) : undefined, after: auditFields(after), params: { kind: after.kind } });
    return ok(toView(tx, after));
  });
}

const endSchema = z.object({ id: z.string().min(1), until: z.iso.date(), reason: z.string().trim().max(500).optional() });

/** `finance.entriesWrite`: beenden — `until` ist der letzte Tag, an dem er dem Verein gehörte; der Grund ist frei und nie im Protokoll. */
export async function endOtherAsset(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<OtherAssetView>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, endSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const before = load(deps.db, v.id);
  if (!before) return notFound('financeOtherAsset', v.id);
  if (before.recordedUntil !== null) return financeConflict('otherAssetEnded');
  if (v.until < before.recordedFrom) return invalid([{ path: 'until', message: 'beforeRecordedFrom' }]);
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(financeOtherAssets).set({ recordedUntil: v.until, endReason: v.reason ? v.reason : null, updatedAt: isoNow(deps.clock) }).where(eq(financeOtherAssets.id, before.id)).run();
    const after = load(tx, before.id)!;
    financeAudit(tx, deps, ctx, { action: 'finance.otherAsset.end', entity: 'financeOtherAsset', id: before.id, before: auditFields(before), after: auditFields(after), params: { kind: after.kind } });
    return ok(toView(tx, after));
  });
}

const revalueSchema = z.object({ id: z.string().min(1), from: z.iso.date(), valueCents: cents, basis });

/**
 * `finance.entriesWrite`: „Neuer Wert ab …“ (11g) — der Eintrag endet am Vortag von `from`, ein Nachfolger mit
 * gleicher Art, Bezeichnung und gleichem Beleg beginnt an `from`. So bleibt jeder Stichtag richtig, ohne zu löschen.
 */
export async function revalueOtherAsset(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ ended: OtherAssetView; successor: OtherAssetView }>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, revalueSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const before = load(deps.db, v.id);
  if (!before) return notFound('financeOtherAsset', v.id);
  if (before.recordedUntil !== null) return financeConflict('otherAssetEnded');
  if (v.from <= before.recordedFrom) return invalid([{ path: 'from', message: 'notAfterRecordedFrom' }]);
  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    const successorId = newId();
    tx.insert(financeOtherAssets)
      .values({ id: successorId, kind: before.kind, label: before.label, valueCents: v.valueCents, basis: v.basis, recordedFrom: v.from, recordedUntil: null, endReason: null, replacedById: null, documentId: before.documentId, createdAt: now, updatedAt: now })
      .run();
    tx.update(financeOtherAssets).set({ recordedUntil: dayBefore(v.from), replacedById: successorId, updatedAt: now }).where(eq(financeOtherAssets.id, before.id)).run();
    const ended = load(tx, before.id)!;
    const successor = load(tx, successorId)!;
    financeAudit(tx, deps, ctx, { action: 'finance.otherAsset.revalue', entity: 'financeOtherAsset', id: successorId, before: auditFields(before), after: auditFields(successor), params: { kind: successor.kind } });
    return ok({ ended: toView(tx, ended), successor: toView(tx, successor) });
  });
}
