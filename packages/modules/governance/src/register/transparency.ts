import { isoNow, notFound, ok, recordAudit, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { governanceRegisterFilings, type FilingTransparency } from '../schema';
import { filingRowInternal, filingViewInternal, type FilingView } from './filings';
import { TRANSPARENCY_MANUAL_KEYS } from './transparency-rules';

export * from './transparency-rules';

const DAY = z.iso.date();
/** Nur die Fragen 2–4; Frage 1 berechnet Kompass (Joe 2026-10-28), eine Antwort darauf ist ein Prüffehler. */
const answersSchema = z.strictObject(Object.fromEntries(TRANSPARENCY_MANUAL_KEYS.map((k) => [k, z.boolean().optional()])) as Record<(typeof TRANSPARENCY_MANUAL_KEYS)[number], z.ZodOptional<z.ZodBoolean>>);
export const transparencySaveSchema = z.object({
  filingId: z.string().min(1),
  /** Je Prüffrage 2–4 `true` (ja) oder `false` (nein); fehlend = offen. */
  answers: answersSchema,
  checkedOn: DAY,
  /** Bestätigung der Meldung an das Transparenzregister. */
  confirmationDocumentId: z.string().min(1).nullable().optional(),
  /** Abgelegte Auszüge aus dem Transparenzregister. */
  extractDocumentIds: z.array(z.string().min(1)).max(20).optional(),
});

/**
 * Speichert die Prüffragen zum Transparenzregister an der Anmeldung (Spec § 7.2) — auch nach der Eintragung, weil die
 * Bestätigung oft erst danach kommt. Kompass meldet nichts; es fragt und hält fest. Protokoll: Ergebnis und Tag.
 */
export async function saveTransparencyCheck(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FilingView>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, transparencySaveSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const before = filingRowInternal(deps.db, v.filingId);
  if (!before) return notFound('governanceRegisterFiling', v.filingId);
  const answers = Object.fromEntries(Object.entries(v.answers).filter(([, a]) => a !== undefined)) as Record<string, boolean>;
  const transparency: FilingTransparency = {
    answers,
    checkedOn: v.checkedOn,
    confirmationDocumentId: v.confirmationDocumentId !== undefined ? v.confirmationDocumentId : (before.transparency?.confirmationDocumentId ?? null),
    extractDocumentIds: v.extractDocumentIds ?? before.transparency?.extractDocumentIds ?? [],
  };
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(governanceRegisterFilings).set({ transparency, updatedAt: isoNow(deps.clock) }).where(eq(governanceRegisterFilings.id, before.id)).run();
    const view = filingViewInternal(tx, deps, filingRowInternal(tx, before.id)!);
    recordAudit(tx, deps, ctx, { action: 'governance.register.transparency', entityType: 'governanceRegisterFiling', entityId: before.id, before: { transparency: before.transparency }, after: { transparency }, params: { result: view.transparency.result, checkedOn: v.checkedOn } });
    return ok(view);
  });
}
