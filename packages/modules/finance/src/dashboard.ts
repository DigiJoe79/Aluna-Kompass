import type { DashboardLine, DashboardTile } from '@kompass/core';
import { and, eq, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';
import { formatEuro } from './ledger/cash-check';
import { getSetupStatus } from './ledger/setup';
import { listEntries } from './ledger/entries';
import { openCentsInternal } from './ledger/open-items';
import { purposeBalancesAt } from './ledger/queries';
import { financeEntries, financeOpenItems, type FinanceOpenItemRow } from './schema';

/**
 * Die sechs Kacheln der Startseite (F3b Task 6, Spec 9.7): je genau ein
 * Recht. `finance.todo` und `finance.setupIncomplete` sind in der Vorgabe an
 * — die Einzelkacheln des Schatzmeisters (Beleg, Entwürfe, offene Zahlungen,
 * Zwecke) bleiben aus, weil die Sammelkachel sie trägt.
 */

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Entwürfe ab 14 Tagen sind „zu alt“ (Entschieden 3, F3b) — ab Tag 15, fester Wert. */
const STALE_DRAFT_DAYS = 14;

/**
 * Überfällige offene Zahlungen, ohne Rechteprüfung — für die Kachel unter
 * `finance.overview` (Stufe unter `finance.read`, das `listOpenItems`
 * verlangt): nicht stornierte Posten mit Fälligkeit vor `today` und noch
 * offenem Betrag (`openCentsInternal`, Spec 5.6 — nie gespeichert).
 */
function overdueOpenItemsInternal(deps: Parameters<DashboardTile['load']>[0], today: string, kind?: 'receivable' | 'payable'): (FinanceOpenItemRow & { openCents: number })[] {
  const where = kind ? and(isNull(financeOpenItems.cancelledAt), eq(financeOpenItems.kind, kind)) : isNull(financeOpenItems.cancelledAt);
  const rows = deps.db.select().from(financeOpenItems).where(where).all();
  return rows
    .filter((r) => r.dueOn !== null && r.dueOn < today)
    .map((r) => ({ ...r, openCents: openCentsInternal(deps.db, r.id) }))
    .filter((r) => r.openCents !== 0);
}

const todoTile: DashboardTile<Record<string, never>> = {
  key: 'todo',
  permission: 'finance.read',
  kind: 'list',
  defaultOn: true,
  options: z.object({}),
  messageKeys: ['reviewedNotFinal', 'withoutVoucher', 'overdueItems'],
  async load(deps, ctx) {
    const today = isoDay(deps.clock.now().getTime());
    const lines: DashboardLine[] = [];

    // Geprüft, aber noch nicht festgeschrieben — keine Namen, nur Zählung; das Datum ist die
    // älteste betroffene Buchung (eigene Spalte der Kachel, nicht im Satz selbst).
    const reviewedRes = await listEntries(deps, ctx, { state: 'reviewed', limit: 200 });
    if (reviewedRes.ok && reviewedRes.value.total > 0) {
      const oldest = reviewedRes.value.entries.reduce((min, e) => (e.reviewedAt && (!min || e.reviewedAt < min) ? e.reviewedAt : min), null as string | null);
      lines.push({ date: (oldest ?? today).slice(0, 10), titleKey: 'reviewedNotFinal', values: { count: reviewedRes.value.total }, href: '/finance/entries?state=reviewed' });
    }

    // Festgeschriebene Buchungen ohne Beleg.
    const withoutVoucherRes = await listEntries(deps, ctx, { state: 'final', withoutVoucher: true, limit: 1 });
    if (withoutVoucherRes.ok && withoutVoucherRes.value.total > 0) {
      lines.push({ titleKey: 'withoutVoucher', values: { count: withoutVoucherRes.value.total }, href: '/finance/entries?novoucher=1' });
    }

    // Überfällige offene Zahlungen — hier nur „Wir zahlen noch“ (payable): die Vereinspflicht, die zählt
    // als „zu tun“. Überfällige Forderungen (receivable) zeigt die eigene Kachel `finance.overdueItems`.
    const overdue = overdueOpenItemsInternal(deps, today, 'payable');
    if (overdue.length > 0) {
      const sumCents = overdue.reduce((s, i) => s + i.openCents, 0);
      lines.push({ titleKey: 'overdueItems', values: { count: overdue.length, sum: formatEuro(sumCents) }, href: '/finance/open-items?tab=payable' });
    }

    return { kind: 'list', lines, total: lines.length, href: '/finance/entries' };
  },
};

const withoutVoucherTile: DashboardTile<Record<string, never>> = {
  key: 'withoutVoucher',
  permission: 'finance.read',
  kind: 'count',
  defaultOn: false,
  options: z.object({}),
  async load(deps, ctx) {
    const res = await listEntries(deps, ctx, { state: 'final', withoutVoucher: true, limit: 1 });
    return { kind: 'count', count: res.ok ? res.value.total : 0, href: '/finance/entries?novoucher=1' };
  },
};

const staleDraftsTile: DashboardTile<Record<string, never>> = {
  key: 'staleDrafts',
  permission: 'finance.read',
  kind: 'count',
  defaultOn: false,
  options: z.object({}),
  load(deps) {
    // Voller Zeitstempel, nicht nur das Datum: `created_at` trägt eine Uhrzeit,
    // ein reiner Datums-Cutoff verglich sonst „2026-09-05“ (Cutoff) gegen
    // „2026-09-05T08:00:00.000Z“ (Zeile) und hielte die Zeile fälschlich für jünger.
    const cutoff = new Date(deps.clock.now().getTime() - STALE_DRAFT_DAYS * 86_400_000).toISOString();
    const rows = deps.db
      .select({ id: financeEntries.id })
      .from(financeEntries)
      .where(and(eq(financeEntries.status, 'draft'), isNull(financeEntries.reversedByEntryId), lt(financeEntries.createdAt, cutoff)))
      .all();
    return { kind: 'count', count: rows.length, href: '/finance/entries?state=draft' };
  },
};

const overdueItemsTile: DashboardTile<Record<string, never>> = {
  key: 'overdueItems',
  permission: 'finance.overview',
  kind: 'count',
  defaultOn: false,
  options: z.object({}),
  load(deps) {
    const today = isoDay(deps.clock.now().getTime());
    const overdue = overdueOpenItemsInternal(deps, today);
    return { kind: 'count', count: overdue.length, href: '/finance/open-items' };
  },
};

const purposesNegativeTile: DashboardTile<Record<string, never>> = {
  key: 'purposesNegative',
  permission: 'finance.overview',
  kind: 'count',
  defaultOn: false,
  options: z.object({}),
  load(deps) {
    const today = isoDay(deps.clock.now().getTime());
    const negative = purposeBalancesAt(deps.db, today).filter((p) => p.balanceCents < 0);
    return { kind: 'count', count: negative.length, href: '/admin/finance?panel=purposes' };
  },
};

const setupIncompleteTile: DashboardTile<Record<string, never>> = {
  key: 'setupIncomplete',
  permission: 'finance.setup',
  kind: 'status',
  defaultOn: true,
  options: z.object({}),
  messageKeys: ['incomplete', 'complete'],
  async load(deps, ctx) {
    const res = await getSetupStatus(deps, ctx);
    const open = res.ok ? res.value.steps.filter((s) => !s.done).length : 0;
    if (open === 0) return { kind: 'status', tone: 'neutral', messageKey: 'complete', href: '/admin/finance?panel=checklist' };
    return { kind: 'status', tone: 'warning', messageKey: 'incomplete', values: { count: open }, href: '/admin/finance?panel=checklist' };
  },
};

export const FINANCE_DASHBOARD_TILES: readonly DashboardTile[] = [
  todoTile as DashboardTile,
  withoutVoucherTile as DashboardTile,
  staleDraftsTile as DashboardTile,
  overdueItemsTile as DashboardTile,
  purposesNegativeTile as DashboardTile,
  setupIncompleteTile as DashboardTile,
];
