import { apiTokenNamesFor, isoNow, newId, notFound, ok, recordAudit, requirePermission, schema, userNamesFor, validate, type CallContext, type Deps, type Result } from '@kompass/core';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { sitePublishes } from '../schema';
import { tailLog, trimPaths, type PathList } from './job-view';

export type PublishRecord = typeof sitePublishes.$inferSelect;

export interface PublishDiff {
  changed: string[];
  added: string[];
  removed: string[];
}

/** Woher ein Publish kam: Kanal und, bei MCP, der Name des API-Tokens. Aus dem Audit-Eintrag, nicht aus einer eigenen Spalte. */
export interface PublishSource {
  channel: 'ui' | 'mcp' | 'system';
  tokenName: string | null;
}

export interface PublishSummary {
  id: string;
  environment: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'success' | 'failed' | 'aborted';
  contentHash: string;
  pagesChanged: number;
  pagesAdded: number;
  pagesRemoved: number;
  summary: string;
  triggeredByUserId: string | null;
  triggeredByName: string | null;
  source: PublishSource;
  hasLog: boolean;
}

export interface PublishDetail extends PublishSummary {
  files: PathList;
  log: { text: string; truncated: boolean };
}

/** Spalten ohne Dateiverzeichnis und Protokoll: Eine Zeile soll Bytes kosten, nicht Hunderte Kilobyte. */
const summaryColumns = {
  id: sitePublishes.id,
  environment: sitePublishes.environment,
  startedAt: sitePublishes.startedAt,
  finishedAt: sitePublishes.finishedAt,
  status: sitePublishes.status,
  contentHash: sitePublishes.contentHash,
  pagesChanged: sitePublishes.pagesChanged,
  pagesAdded: sitePublishes.pagesAdded,
  pagesRemoved: sitePublishes.pagesRemoved,
  summary: sitePublishes.summary,
  triggeredByUserId: sitePublishes.triggeredByUserId,
  hasLog: sql<number>`length(${sitePublishes.log}) > 0`,
};

/** Eine Abfrage für alle gelisteten Publishes: `recordPublish` schreibt je Publish genau einen Eintrag `site.publish`. */
function sourcesFor(deps: Deps, ids: string[]): Map<string, PublishSource> {
  if (ids.length === 0) return new Map();
  const { auditLog } = schema;
  const rows = deps.db
    .select({ entityId: auditLog.entityId, channel: auditLog.channel, apiTokenId: auditLog.apiTokenId })
    .from(auditLog)
    .where(and(eq(auditLog.entityType, 'sitePublish'), eq(auditLog.action, 'site.publish'), inArray(auditLog.entityId, ids)))
    .all();
  const tokens = apiTokenNamesFor(deps, rows.map((r) => r.apiTokenId));
  return new Map(rows.map((r): [string, PublishSource] => [r.entityId ?? '', { channel: r.channel, tokenName: r.apiTokenId ? (tokens.get(r.apiTokenId) ?? null) : null }]));
}

const withNames = (deps: Deps, rows: (Omit<PublishSummary, 'triggeredByName' | 'hasLog' | 'source'> & { hasLog: unknown })[]): PublishSummary[] => {
  const names = userNamesFor(deps, rows.map((r) => r.triggeredByUserId));
  const sources = sourcesFor(deps, rows.map((r) => r.id));
  return rows.map((r) => ({
    ...r,
    hasLog: Boolean(r.hasLog),
    triggeredByName: r.triggeredByUserId ? (names.get(r.triggeredByUserId) ?? null) : null,
    // Ein Eintrag ohne Audit-Zeile (gibt es nur von Hand eingefügt) zählt als Oberfläche: keine Marke, nichts Falsches behauptet.
    source: sources.get(r.id) ?? { channel: 'ui', tokenName: null },
  }));
};

const listSchema = z.object({ environment: z.string().min(1).optional(), limit: z.number().int().min(1).max(200).optional() });

export async function listPublishes(deps: Deps, ctx: CallContext, input: { environment?: string; limit?: number } = {}): Promise<Result<PublishSummary[]>> {
  const denied = requirePermission(ctx, 'site.view');
  if (denied) return denied;
  const parsed = validate(deps, listSchema, input);
  if (!parsed.ok) return parsed;
  const rows = deps.db
    .select(summaryColumns)
    .from(sitePublishes)
    .where(eq(sitePublishes.environment, parsed.value.environment ?? deps.env))
    .orderBy(desc(sitePublishes.startedAt))
    .limit(parsed.value.limit ?? 20)
    .all();
  return ok(withNames(deps, rows));
}

const getSchema = z.object({ id: z.string().min(1), paths: z.literal('all').optional(), log: z.literal('full').optional() });

export async function getPublish(deps: Deps, ctx: CallContext, input: { id: string; paths?: 'all'; log?: 'full' }): Promise<Result<PublishDetail>> {
  const denied = requirePermission(ctx, 'site.view');
  if (denied) return denied;
  const parsed = validate(deps, getSchema, input);
  if (!parsed.ok) return parsed;
  const row = deps.db.select({ ...summaryColumns, log: sitePublishes.log, fileManifest: sitePublishes.fileManifest }).from(sitePublishes).where(eq(sitePublishes.id, parsed.value.id)).get();
  if (!row) return notFound('sitePublish', parsed.value.id);
  const { log, fileManifest, ...rest } = row;
  const files = Object.keys(JSON.parse(fileManifest) as Record<string, string>).sort();
  return ok({
    ...withNames(deps, [rest])[0]!,
    files: trimPaths(files, parsed.value.paths === 'all' ? Infinity : undefined),
    log: tailLog(log, parsed.value.log === 'full' ? Infinity : undefined),
  });
}

export function lastSuccessfulPublish(deps: Deps, environment: string): PublishRecord | null {
  return deps.db.select().from(sitePublishes).where(and(eq(sitePublishes.environment, environment), eq(sitePublishes.status, 'success'))).orderBy(desc(sitePublishes.startedAt)).get() ?? null;
}

/** Der jüngste Publish dieser Umgebung, gleich welchen Ausgangs — für die Kachel „Webseite“. */
export function lastPublish(deps: Deps, environment: string): PublishRecord | null {
  return deps.db.select().from(sitePublishes).where(eq(sitePublishes.environment, environment)).orderBy(desc(sitePublishes.startedAt)).get() ?? null;
}

export function recordPublish(deps: Deps, ctx: CallContext, input: { environment: string; startedAt: string; status: 'success' | 'failed' | 'aborted'; contentHash: string; diff: PublishDiff; fileManifest: Record<string, string>; log: string; summary: string }): PublishRecord {
  return deps.db.transaction((tx) => {
    const id = newId();
    tx.insert(sitePublishes).values({
      id,
      environment: input.environment,
      startedAt: input.startedAt,
      finishedAt: isoNow(deps.clock),
      status: input.status,
      contentHash: input.contentHash,
      pagesChanged: input.diff.changed.length,
      pagesAdded: input.diff.added.length,
      pagesRemoved: input.diff.removed.length,
      summary: input.summary,
      triggeredByUserId: ctx.userId,
      log: input.log.slice(-20_000),
      fileManifest: JSON.stringify(input.fileManifest),
    }).run();
    recordAudit(tx, deps, ctx, {
      action: 'site.publish',
      entityType: 'sitePublish',
      entityId: id,
      after: {
        environment: input.environment,
        status: input.status,
        contentHash: input.contentHash,
        changed: input.diff.changed.length,
        added: input.diff.added.length,
        removed: input.diff.removed.length,
      },
      summary: input.summary,
    });
    return tx.select().from(sitePublishes).where(eq(sitePublishes.id, id)).get()!;
  });
}
