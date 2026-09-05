import { isoNow } from '../clock';
import type { CallContext } from '../context';
import type { DbOrTx } from '../db/client';
import { auditLog } from '../db/schema';
import type { Deps } from '../deps';
import { newId } from '../ids';

export interface AuditInput {
  action: string;
  entityType: string;
  entityId: string | null;
  before?: unknown;
  after?: unknown;
  summary: string;
}

const toJson = (value: unknown): string | null => (value === undefined ? null : JSON.stringify(value));

export function recordAudit(
  tx: DbOrTx,
  deps: Pick<Deps, 'clock' | 'env'>,
  ctx: CallContext,
  input: AuditInput,
): string {
  const id = newId();
  tx.insert(auditLog)
    .values({
      id,
      occurredAt: isoNow(deps.clock),
      userId: ctx.userId,
      channel: ctx.channel,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: toJson(input.before),
      after: toJson(input.after),
      summary: input.summary,
      apiTokenId: ctx.apiTokenId,
      ipAddress: ctx.ipAddress,
      requestId: ctx.requestId,
      environment: deps.env,
    })
    .run();
  return id;
}
