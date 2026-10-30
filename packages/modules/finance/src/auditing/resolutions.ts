import { ok, validate, type CallContext, type Deps, type Result } from '@kompass/core';
import { readLinkedDocument } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { financeFiscalYears } from '../schema';
import { auditResolutionsOf } from '../sources';

/** Der berechnete Bezug (G-30): je Geschäftsjahr die Protokolle der Beschlüsse in Abschnitt 9 der Kassenprüfung. */
export const AUDIT_RESOLUTION_LINK = 'financeAuditResolutions';

const minutesSchema = z.object({ fiscalYearId: z.string().min(1), resolutionId: z.string().min(1) });

/**
 * Das Protokoll eines Beschlusses aus Abschnitt 9 (G-30, Joe 2026-10-29, Option B): Die Prüferin mit `finance.audit`
 * öffnet genau die Protokolle der finanzwirksamen Beschlüsse ihres Prüfjahres, ohne `governance.read` und ohne
 * `dms.view` — sonst kein Dokument der Gremien. Recht und Bezug prüft die Akte (`readLinkedDocument`, Prinzip 6) gegen
 * den berechneten Bezug `financeAuditResolutions`. Bytes: kein MCP-Werkzeug (wie die Belege).
 */
export async function readAuditResolutionMinutes(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ bytes: Uint8Array; filename: string; number: string | null }>> {
  const parsed = validate(deps, minutesSchema, input);
  if (!parsed.ok) return parsed;
  const { fiscalYearId, resolutionId } = parsed.value;
  const year = deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, fiscalYearId)).get();
  const minutesId = year ? (auditResolutionsOf(deps, deps.db, year) ?? []).find((r) => r.id === resolutionId)?.minutesDocumentId : null;
  // Ohne Protokoll fragt die Akte nach einer Kennung, die es nicht gibt: Recht vor Bezug, wie bei jedem Dokument.
  const result = await readLinkedDocument(deps, ctx, { documentId: minutesId ?? resolutionId, entityType: AUDIT_RESOLUTION_LINK, entityId: fiscalYearId });
  if (!result.ok) return result;
  return ok({ bytes: result.value.bytes, filename: result.value.filename, number: result.value.record.number });
}
