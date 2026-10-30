import { and, eq, isNull } from 'drizzle-orm';
import { recordAudit } from '../audit/log';
import { isoNow } from '../clock';
import type { CallContext } from '../context';
import type { DbOrTx } from '../db/client';
import { followUps, users } from '../db/schema';
import type { Deps } from '../deps';
import { newId } from '../ids';
import { resolveRecordLabel } from '../modules/record-hooks';
import type { FollowUpRecord } from './service';

export interface FollowUpInternalInput {
  entityType: string;
  entityId: string;
  /** Fälligkeit als Tag `YYYY-MM-DD`. */
  dueAt: string;
  title: string;
  assigneeUserId: string | null;
}

/**
 * Legt eine Wiedervorlage in der Transaktion des Aufrufers an — Zeile und Protokoll wie `createFollowUp`, aber ohne
 * Rechteprüfung und ohne eigene Transaktion: nur aus Diensten anderer Module in deren Transaktion; die Prüfung hat der
 * Dienst gemacht (etwa das Festschreiben einer Sitzung der Gremien, das einen Auftrag zur Wiedervorlage macht). Ein
 * unbekannter Nutzer ist ein Programmfehler des Aufrufers und wirft.
 */
export function createFollowUpInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, input: FollowUpInternalInput): FollowUpRecord {
  if (input.assigneeUserId && !tx.select({ id: users.id }).from(users).where(eq(users.id, input.assigneeUserId)).get()) throw new Error(`createFollowUpInternal: unknown user ${input.assigneeUserId}`);
  // Dieselbe Namensregel wie `createFollowUp`: bei einem heiklen Datensatz nur dessen Kennung.
  const label = resolveRecordLabel(deps, ctx, input.entityType, input.entityId);
  const sensitive = !!label?.sensitive;
  const params = sensitive ? { label: label!.auditLabel ?? label!.label, onRecord: true } : { label: input.title, onRecord: false };
  const id = newId();
  const now = isoNow(deps.clock);
  tx.insert(followUps)
    .values({ id, entityType: input.entityType, entityId: input.entityId, dueAt: input.dueAt, title: input.title, assigneeUserId: input.assigneeUserId, createdByUserId: ctx.userId ?? 'system', createdAt: now, doneAt: null, doneByUserId: null, updatedAt: now })
    .run();
  const record: FollowUpRecord = { ...tx.select().from(followUps).where(eq(followUps.id, id)).get()!, titleHidden: false };
  recordAudit(tx, deps, ctx, { action: 'followUps.create', entityType: 'followUp', entityId: id, after: sensitive ? { ...record, title: '' } : record, params: { ...params, dueOn: input.dueAt } });
  return record;
}

export interface FollowUpCompleteFilter {
  entityType: string;
  entityId: string;
  /** Nur Wiedervorlagen, deren Titel so beginnt (etwa die Bitte um Abzeichnung). */
  titlePrefix?: string;
}

/**
 * Erledigt die offenen Wiedervorlagen an einem Datensatz in der Transaktion des Aufrufers — je eine Protokollzeile
 * `followUps.complete` wie `completeFollowUp`, ohne Rechteprüfung (der Dienst hat geprüft; etwa das Abzeichnen der
 * Jahresrechnung erledigt die Bitte darum). Liefert die Zahl.
 */
export function completeFollowUpsInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, filter: FollowUpCompleteFilter): number {
  const conditions = [eq(followUps.entityType, filter.entityType), eq(followUps.entityId, filter.entityId), isNull(followUps.doneAt)];
  const open = tx
    .select()
    .from(followUps)
    .where(and(...conditions))
    .all()
    .filter((row) => !filter.titlePrefix || row.title.startsWith(filter.titlePrefix));
  const now = isoNow(deps.clock);
  for (const row of open) {
    tx.update(followUps).set({ doneAt: now, doneByUserId: ctx.userId, updatedAt: now }).where(eq(followUps.id, row.id)).run();
    const label = resolveRecordLabel(deps, ctx, row.entityType, row.entityId);
    const params = label?.sensitive ? { label: label.auditLabel ?? label.label, onRecord: true } : { label: row.title, onRecord: false };
    recordAudit(tx, deps, ctx, { action: 'followUps.complete', entityType: 'followUp', entityId: row.id, before: { doneAt: null }, after: { doneAt: now }, params });
  }
  return open.length;
}
