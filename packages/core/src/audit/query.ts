import { and, desc, eq, getTableColumns, gte, inArray, like, lte, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { CallContext } from '../context';
import { apiTokens, auditLog, users } from '../db/schema';
import type { Deps } from '../deps';
import { requirePermission } from '../permissions/check';
import { notFound, ok, type Result } from '../result';
import { validate } from '../validate';
import type { AuditParam } from './log';

export interface AuditEntry {
  id: string;
  occurredAt: string;
  userId: string | null;
  userName: string | null;
  channel: 'ui' | 'mcp' | 'system';
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  /** Werte für den Satz der Aktion (`audit.sentences.*`); `null` bei Einträgen ohne Werte und von vor 0.2.9. */
  params: Record<string, AuditParam> | null;
  /** Namen der Nutzer aus `…UserId`-Parametern, wie `userName` (null = Nutzer gibt es nicht mehr). */
  paramUserNames: Record<string, string | null>;
  apiTokenId: string | null;
  /** Name des API-Tokens bei Vorgängen über MCP; null, wenn es keinen gibt oder er nicht mehr existiert. */
  apiTokenName: string | null;
  ipAddress: string | null;
  requestId: string;
  environment: string;
}

const querySchema = z.object({
  userId: z.string().optional(),
  channel: z.enum(['ui', 'mcp', 'system']).optional(),
  action: z.string().optional(),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  text: z.string().trim().min(1).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

/** Parameter, die einen Nutzer nennen (Spec Protokoll § 2): `userId` oder `…UserId`. */
const isUserParam = (key: string) => /(^u|U)serId$/.test(key);

/** Füllt `paramUserNames` aller Einträge mit einer Abfrage auf die Nutzertabelle. */
function withParamUserNames(deps: Deps, entries: AuditEntry[]): AuditEntry[] {
  const ids = new Set<string>();
  for (const entry of entries) {
    for (const [key, value] of Object.entries(entry.params ?? {})) if (isUserParam(key) && typeof value === 'string') ids.add(value);
  }
  if (ids.size === 0) return entries;
  const names = new Map(deps.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [...ids])).all().map((u) => [u.id, u.name]));
  for (const entry of entries) {
    for (const [key, value] of Object.entries(entry.params ?? {})) {
      if (isUserParam(key) && typeof value === 'string') entry.paramUserNames[value] = names.get(value) ?? null;
    }
  }
  return entries;
}

const parseJson = (value: string | null): unknown => (value === null ? null : JSON.parse(value));

type Row = typeof auditLog.$inferSelect & { userName: string | null; apiTokenName: string | null };

const toEntry = (row: Row): AuditEntry => ({
  paramUserNames: {},
  id: row.id,
  occurredAt: row.occurredAt,
  userId: row.userId,
  userName: row.userName,
  channel: row.channel,
  action: row.action,
  entityType: row.entityType,
  entityId: row.entityId,
  before: parseJson(row.before),
  after: parseJson(row.after),
  params: row.params ? (JSON.parse(row.params) as Record<string, AuditParam>) : null,
  apiTokenId: row.apiTokenId,
  apiTokenName: row.apiTokenName,
  ipAddress: row.ipAddress,
  requestId: row.requestId,
  environment: row.environment,
});

/**
 * `audit.view`: alle Aktionen, die im Protokoll vorkommen, je einmal und sortiert — die Auswahl des Filters
 * „Aktion“. Über das ganze Protokoll, nicht nur die jüngsten Einträge (Spec Filterleisten § 4).
 */
export function listAuditActions(deps: Deps, ctx: CallContext): Result<string[]> {
  const denied = requirePermission(ctx, 'audit.view');
  if (denied) return denied;
  const rows = deps.db.selectDistinct({ action: auditLog.action }).from(auditLog).orderBy(auditLog.action).all();
  return ok(rows.map((row) => row.action));
}

export function queryAudit(deps: Deps, ctx: CallContext, input: unknown): Result<{ entries: AuditEntry[]; total: number }> {
  const denied = requirePermission(ctx, 'audit.view');
  if (denied) return denied;
  const parsed = validate(deps, querySchema, input);
  if (!parsed.ok) return parsed;
  const q = parsed.value;
  const conditions: SQL[] = [];
  if (q.userId) conditions.push(eq(auditLog.userId, q.userId));
  if (q.channel) conditions.push(eq(auditLog.channel, q.channel));
  if (q.action) conditions.push(eq(auditLog.action, q.action));
  if (q.entityType) conditions.push(eq(auditLog.entityType, q.entityType));
  if (q.entityId) conditions.push(eq(auditLog.entityId, q.entityId));
  if (q.from) conditions.push(gte(auditLog.occurredAt, q.from));
  if (q.to) conditions.push(lte(auditLog.occurredAt, q.to));
  if (q.text) {
    const pattern = `%${q.text}%`;
    conditions.push(or(like(auditLog.params, pattern), like(auditLog.entityId, pattern), like(auditLog.after, pattern), like(auditLog.before, pattern)) as SQL);
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const total = deps.db.select({ count: sql<number>`count(*)` }).from(auditLog).where(where).get()?.count ?? 0;
  const rows = deps.db
    .select({ ...getTableColumns(auditLog), userName: users.name, apiTokenName: apiTokens.name })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .leftJoin(apiTokens, eq(apiTokens.id, auditLog.apiTokenId))
    .where(where)
    .orderBy(desc(auditLog.occurredAt), desc(auditLog.id))
    .limit(q.limit)
    .offset(q.offset)
    .all();
  return ok({ entries: withParamUserNames(deps, rows.map((row) => toEntry(row as Row))), total });
}

export function getAuditEntry(deps: Deps, ctx: CallContext, id: string): Result<AuditEntry> {
  const denied = requirePermission(ctx, 'audit.view');
  if (denied) return denied;
  const row = deps.db
    .select({ ...getTableColumns(auditLog), userName: users.name, apiTokenName: apiTokens.name })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .leftJoin(apiTokens, eq(apiTokens.id, auditLog.apiTokenId))
    .where(eq(auditLog.id, id))
    .get();
  return row ? ok(withParamUserNames(deps, [toEntry(row as Row)])[0]!) : notFound('auditEntry', id);
}
