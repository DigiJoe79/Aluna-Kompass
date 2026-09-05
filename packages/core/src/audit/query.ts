import { and, desc, eq, getTableColumns, gte, like, lte, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { CallContext } from '../context';
import { auditLog, users } from '../db/schema';
import type { Deps } from '../deps';
import { requirePermission } from '../permissions/check';
import { notFound, ok, type Result } from '../result';
import { validate } from '../validate';

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
  summary: string;
  apiTokenId: string | null;
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

const parseJson = (value: string | null): unknown => (value === null ? null : JSON.parse(value));

type Row = typeof auditLog.$inferSelect & { userName: string | null };

const toEntry = (row: Row): AuditEntry => ({
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
  summary: row.summary,
  apiTokenId: row.apiTokenId,
  ipAddress: row.ipAddress,
  requestId: row.requestId,
  environment: row.environment,
});

export function queryAudit(deps: Deps, ctx: CallContext, input: unknown): Result<{ entries: AuditEntry[]; total: number }> {
  const denied = requirePermission(ctx, 'audit.view');
  if (denied) return denied;
  const parsed = validate(querySchema, input);
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
    conditions.push(or(like(auditLog.summary, pattern), like(auditLog.entityId, pattern), like(auditLog.after, pattern), like(auditLog.before, pattern)) as SQL);
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const total = deps.db.select({ count: sql<number>`count(*)` }).from(auditLog).where(where).get()?.count ?? 0;
  const rows = deps.db
    .select({ ...getTableColumns(auditLog), userName: users.name })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(where)
    .orderBy(desc(auditLog.occurredAt), desc(auditLog.id))
    .limit(q.limit)
    .offset(q.offset)
    .all();
  return ok({ entries: rows.map((row) => toEntry(row as Row)), total });
}

export function getAuditEntry(deps: Deps, ctx: CallContext, id: string): Result<AuditEntry> {
  const denied = requirePermission(ctx, 'audit.view');
  if (denied) return denied;
  const row = deps.db
    .select({ ...getTableColumns(auditLog), userName: users.name })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(eq(auditLog.id, id))
    .get();
  return row ? ok(toEntry(row as Row)) : notFound('auditEntry', id);
}
