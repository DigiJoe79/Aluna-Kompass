import { isoNow } from '../clock';
import type { CallContext } from '../context';
import type { DbOrTx } from '../db/client';
import { auditLog } from '../db/schema';
import type { Deps } from '../deps';
import { newId } from '../ids';
import type { Registry } from '../modules/registry';

/** Ein Wert für den Satz einer Aktion: Code, Zahl, ISO-Datum, Kennung, Nutzdatum — nie Text des Codes (Spec Protokoll § 2). */
export type AuditParam = string | number | boolean | null;

export interface AuditInput {
  action: string;
  entityType: string;
  entityId: string | null;
  before?: unknown;
  after?: unknown;
  /** Werte für den Satz der Aktion in `audit.sentences.*`; Personen nur als ID (`…UserId`, `…ContactId`). */
  params?: Record<string, AuditParam>;
}

const toJson = (value: unknown): string | null => (value === undefined ? null : JSON.stringify(value));

function checkParams(registry: Registry, action: string, params: Record<string, AuditParam> | undefined): void {
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) throw new Error(`audit ${action}: param ${key} is not a scalar`);
  }
  const def = registry.auditActions.get(action);
  // Jede Aktion steht im Katalog eines Manifests (`auditActions`); eine unbekannte ist ein Fehler im Code.
  if (!def) throw new Error(`audit ${action}: not in any auditActions catalog`);
  const given = Object.keys(params ?? {});
  const extra = given.filter((key) => !def.params.includes(key));
  const missing = def.params.filter((key) => !given.includes(key));
  if (extra.length || missing.length) throw new Error(`audit ${action}: unexpected ${extra.join(', ') || '—'}, missing ${missing.join(', ') || '—'}`);
}

export function recordAudit(
  tx: DbOrTx,
  deps: Pick<Deps, 'clock' | 'env' | 'registry'>,
  ctx: CallContext,
  input: AuditInput,
): string {
  checkParams(deps.registry, input.action, input.params);
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
      params: input.params && Object.keys(input.params).length > 0 ? JSON.stringify(input.params) : null,
      apiTokenId: ctx.apiTokenId,
      ipAddress: ctx.ipAddress,
      requestId: ctx.requestId,
      environment: deps.env,
    })
    .run();
  return id;
}
