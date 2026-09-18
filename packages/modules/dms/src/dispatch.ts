import {
  conflict,
  invalid,
  isoNow,
  notFound,
  ok,
  readSetting,
  recordAudit,
  requirePermission,
  validate,
  type CallContext,
  type DbOrTx,
  type Deps,
  type Result,
} from '@kompass/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { DispatchChannel } from './install';
import { documents } from './schema';
import { toRecord, type DocumentRecord } from './service';

export const dispatchSchema = z.object({
  id: z.string().min(1),
  sentAt: z.string().date(),
  sentVia: z.string().trim().min(1),
  note: z.string().trim().max(300).optional(),
});

export const dispatchClearSchema = z.object({ id: z.string().min(1) });

export function dispatchChannels(deps: Deps): DispatchChannel[] {
  return readSetting<DispatchChannel[]>(deps, 'dms.dispatchChannels');
}

/**
 * Ein Vermerk je Dokument (Entscheidung 34). Er ändert nichts am Dokument,
 * nur an dem, was daneben steht — deshalb darf er an einem festgeschriebenen
 * Dokument gesetzt und korrigiert werden, mit Vorher und Nachher im Protokoll.
 */
export async function recordDispatch(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DocumentRecord>> {
  const denied = requirePermission(ctx, 'dms.create');
  if (denied) return denied;
  const parsed = validate(deps, dispatchSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  const row = deps.db.select().from(documents).where(eq(documents.id, v.id)).get();
  if (!row) return notFound('document', v.id);
  if (row.phase !== 'issued') return conflict('documentIsDraft', `Entwurf „${row.subject}“ wurde noch nicht festgeschrieben`);
  if (row.direction !== 'outgoing') return conflict('notOutgoing', `Dokument ${row.number} ist eingegangen, nicht versandt`);

  if (!dispatchChannels(deps).some((c) => c.key === v.sentVia)) return invalid([{ path: 'sentVia', message: 'unknownDispatchChannel' }]);
  if (v.sentAt < row.documentDate) return invalid([{ path: 'sentAt', message: 'sentBeforeDocumentDate' }]);
  if (v.sentAt > deps.clock.now().toISOString().slice(0, 10)) return invalid([{ path: 'sentAt', message: 'sentInFuture' }]);

  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    tx.update(documents).set({ sentAt: v.sentAt, sentVia: v.sentVia, sentNote: v.note ?? null, updatedAt: now }).where(eq(documents.id, row.id)).run();
    const after = tx.select().from(documents).where(eq(documents.id, row.id)).get()!;
    recordAudit(tx, deps, ctx, {
      action: 'dms.dispatch',
      entityType: 'document',
      entityId: row.id,
      before: { sentAt: row.sentAt, sentVia: row.sentVia, sentNote: row.sentNote },
      after: { sentAt: after.sentAt, sentVia: after.sentVia, sentNote: after.sentNote },
      summary: `Dokument ${row.number} als versandt vermerkt: ${v.sentAt} per ${v.sentVia}`,
    });
    return ok(toRecord(deps, after, tx));
  });
}

export async function clearDispatch(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DocumentRecord>> {
  const denied = requirePermission(ctx, 'dms.create');
  if (denied) return denied;
  const parsed = validate(deps, dispatchClearSchema, input);
  if (!parsed.ok) return parsed;
  const row = deps.db.select().from(documents).where(eq(documents.id, parsed.value.id)).get();
  if (!row) return notFound('document', parsed.value.id);
  if (!row.sentAt) return conflict('notDispatched', `Dokument ${row.number} trägt keinen Versandvermerk`);

  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(documents).set({ sentAt: null, sentVia: null, sentNote: null, updatedAt: isoNow(deps.clock) }).where(eq(documents.id, row.id)).run();
    const after = tx.select().from(documents).where(eq(documents.id, row.id)).get()!;
    recordAudit(tx, deps, ctx, {
      action: 'dms.dispatch.clear',
      entityType: 'document',
      entityId: row.id,
      before: { sentAt: row.sentAt, sentVia: row.sentVia, sentNote: row.sentNote },
      after: { sentAt: null, sentVia: null, sentNote: null },
      summary: `Versandvermerk an Dokument ${row.number} entfernt`,
    });
    return ok(toRecord(deps, after, tx));
  });
}
