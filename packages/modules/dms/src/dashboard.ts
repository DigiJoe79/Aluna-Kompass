import type { DashboardLine, DashboardTile } from '@kompass/core';
import { contacts, displayName } from '@kompass/module-contacts';
import { and, count, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { documentLinks, documents } from './schema';
import { listDocuments } from './service';

/**
 * Die Kacheln der Akte (Spec 2026-09-17, § 5). Jede ist ein Filter auf die
 * Dokumentliste, die es schon gibt; der Link führt genau dorthin.
 */

/** Absender je Dokument, aus den Bezügen mit Rolle `sender` — ein Name, kein Geheimnis. */
function senderNames(deps: Parameters<DashboardTile['load']>[0], documentIds: string[]): Map<string, string> {
  if (documentIds.length === 0) return new Map();
  const links = deps.db
    .select({ documentId: documentLinks.documentId, contactId: documentLinks.entityId })
    .from(documentLinks)
    .where(and(inArray(documentLinks.documentId, documentIds), eq(documentLinks.role, 'sender'), eq(documentLinks.entityType, 'contact')))
    .all();
  const names = new Map<string, string>();
  for (const link of links) {
    const contact = deps.db.select().from(contacts).where(eq(contacts.id, link.contactId)).get();
    if (contact && !names.has(link.documentId)) names.set(link.documentId, displayName(contact));
  }
  return names;
}

const inboxTile: DashboardTile<{ rows: number }> = {
  key: 'inbox',
  permission: 'dms.view',
  kind: 'list',
  defaultOn: true,
  options: z.object({ rows: z.number().int().min(0).max(10).default(5) }),
  async load(deps, ctx, o) {
    const res = await listDocuments(deps, ctx, { inbox: true, limit: Math.max(o.rows, 1), orderBy: { field: 'documentDate', direction: 'asc' } });
    if (!res.ok) return { kind: 'list', lines: [], total: 0, href: '/dms?inbox=1' };
    const shown = o.rows === 0 ? [] : res.value.documents;
    const senders = senderNames(deps, shown.map((d) => d.id));
    const lines: DashboardLine[] = shown.map((d) => {
      const line: DashboardLine = { date: d.documentDate, title: d.subject, href: `/dms/${d.id}` };
      const sender = senders.get(d.id);
      if (sender) line.extra = sender;
      return line;
    });
    return { kind: 'list', lines, total: res.value.total, href: '/dms?inbox=1' };
  },
};

const draftsTile: DashboardTile<{ onlyMine: boolean }> = {
  key: 'drafts',
  permission: 'dms.view',
  kind: 'count',
  defaultOn: true,
  options: z.object({ onlyMine: z.boolean().default(true) }),
  async load(deps, ctx, o) {
    const filter = o.onlyMine && ctx.userId ? { phase: 'draft' as const, limit: 1, createdByUserId: ctx.userId } : { phase: 'draft' as const, limit: 1 };
    const res = await listDocuments(deps, ctx, filter);
    return { kind: 'count', count: res.ok ? res.value.total : 0, href: '/dms?phase=draft' };
  },
};

const unsentTile: DashboardTile<Record<string, never>> = {
  key: 'unsent',
  permission: 'dms.view',
  kind: 'count',
  defaultOn: true,
  options: z.object({}),
  async load(deps, ctx) {
    const res = await listDocuments(deps, ctx, { unsent: true, limit: 1 });
    return { kind: 'count', count: res.ok ? res.value.total : 0, href: '/dms?unsent=1' };
  },
};

const textFailedTile: DashboardTile<Record<string, never>> = {
  key: 'textFailed',
  permission: 'dms.manage',
  kind: 'count',
  defaultOn: false,
  options: z.object({}),
  load(deps) {
    const row = deps.db.select({ n: count() }).from(documents).where(eq(documents.textStatus, 'failed')).get();
    return { kind: 'count', count: row?.n ?? 0, href: '/dms' };
  },
};

export const DMS_DASHBOARD_TILES: readonly DashboardTile[] = [
  inboxTile as DashboardTile,
  draftsTile as DashboardTile,
  unsentTile as DashboardTile,
  textFailedTile as DashboardTile,
];
