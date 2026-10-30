import { invalid, isoNow, newId, notFound, ok, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { contacts } from '@kompass/module-contacts';
import { documents } from '@kompass/module-dms';
import { and, desc, eq, inArray, lte } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict } from '../errors';
import { NAME_CONSENT_REVOKED_HOOKS } from '../locks';
import { financeNameConsents, type FinanceNameConsentRow } from '../schema';

/**
 * Jahresrechnung (0.4.5, Ve-L-6, Art. 7 Abs. 1 DSGVO): Einwilligung zur Namensnennung in der veröffentlichten
 * Jahresrechnung als Verlauf — „erteilt am … für die Jahresrechnungen ab {Jahr}“ und „widerrufen am …“, nie
 * überschrieben. Das Protokoll trägt Art und Jahr, nie den Kontakt.
 */
export interface NameConsentEntry {
  id: string;
  kind: 'granted' | 'revoked';
  on: string;
  fromYear: number | null;
  documentId: string | null;
  documentNumber: string | null;
  createdAt: string;
  createdByUserId: string;
}

/** Die jüngste zuerst: nach Tag, dann nach Erfassung. */
function rowsOf(db: DbOrTx, contactId: string, at?: string): FinanceNameConsentRow[] {
  return db
    .select()
    .from(financeNameConsents)
    .where(at === undefined ? eq(financeNameConsents.contactId, contactId) : and(eq(financeNameConsents.contactId, contactId), lte(financeNameConsents.on, at)))
    .orderBy(desc(financeNameConsents.on), desc(financeNameConsents.createdAt), desc(financeNameConsents.id))
    .all();
}

/** Ohne Rechteprüfung: der Verlauf eines Kontakts, der jüngste Eintrag zuerst, mit Nummer des verknüpften Dokuments. */
export function nameConsentHistoryInternal(db: DbOrTx, contactId: string): NameConsentEntry[] {
  const rows = rowsOf(db, contactId);
  const ids = rows.flatMap((r) => (r.documentId ? [r.documentId] : []));
  const numbers = new Map(ids.length > 0 ? db.select({ id: documents.id, number: documents.number }).from(documents).where(inArray(documents.id, ids)).all().map((d) => [d.id, d.number] as const) : []);
  return rows.map((r) => ({ id: r.id, kind: r.kind, on: r.on, fromYear: r.fromYear, documentId: r.documentId, documentNumber: r.documentId ? (numbers.get(r.documentId) ?? null) : null, createdAt: r.createdAt, createdByUserId: r.createdByUserId }));
}

/** Gilt am Tag `at` eine Einwilligung für die Jahresrechnung des Jahres `year`? Der jüngste Eintrag bis `at` entscheidet. */
export function nameConsentValidInternal(db: DbOrTx, contactId: string, year: number, at: string): boolean {
  const latest = rowsOf(db, contactId, at)[0];
  return latest !== undefined && latest.kind === 'granted' && latest.fromYear !== null && latest.fromYear <= year;
}

const contactId = z.string().min(1);
const documentId = z.string().min(1).nullable().optional();
export const recordNameConsentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('granted'), contactId, on: z.iso.date(), fromYear: z.number().int().min(2000).max(2100), documentId }),
  z.object({ kind: z.literal('revoked'), contactId, on: z.iso.date(), documentId }),
]);

/**
 * `finance.entriesWrite` (wie die Steuerangaben zum Kontakt): eine Einwilligung erteilen oder widerrufen — ein neuer
 * Eintrag im Verlauf. Nicht in der Zukunft; ein Widerruf verlangt eine geltende Einwilligung. Nach dem Widerruf laufen
 * die Haken `NAME_CONSENT_REVOKED_HOOKS` (J2).
 */
export async function recordNameConsent(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ contactId: string; history: NameConsentEntry[] }>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, recordNameConsentSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (v.on > todayIn(deps)) return invalid([{ path: 'on', message: 'inFuture' }]);
  if (!deps.db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, v.contactId)).get()) return notFound('contact', v.contactId);
  if (v.documentId && !deps.db.select({ id: documents.id }).from(documents).where(eq(documents.id, v.documentId)).get()) return notFound('document', v.documentId);
  if (v.kind === 'revoked' && rowsOf(deps.db, v.contactId, v.on)[0]?.kind !== 'granted') return financeConflict('nameConsentNotGranted');
  const id = newId();
  const fromYear = v.kind === 'granted' ? v.fromYear : null;
  deps.db.transaction((tx: DbOrTx) => {
    tx.insert(financeNameConsents).values({ id, contactId: v.contactId, kind: v.kind, on: v.on, fromYear, documentId: v.documentId ?? null, createdAt: isoNow(deps.clock), createdByUserId: ctx.userId ?? 'system' }).run();
    const after = { kind: v.kind, on: v.on, fromYear, withDocument: !!v.documentId };
    if (v.kind === 'granted') financeAudit(tx, deps, ctx, { action: 'finance.nameConsent.grant', entity: 'financeNameConsent', id, after, params: { fromYear: v.fromYear } });
    else financeAudit(tx, deps, ctx, { action: 'finance.nameConsent.revoke', entity: 'financeNameConsent', id, after, params: {} });
  });
  if (v.kind === 'revoked') for (const hook of NAME_CONSENT_REVOKED_HOOKS) await hook(deps, ctx, v.contactId);
  return ok({ contactId: v.contactId, history: nameConsentHistoryInternal(deps.db, v.contactId) });
}
