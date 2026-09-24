import { readSetting, type DashboardLine, type DashboardTile } from '@kompass/core';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import { countOpenRawTransactionsInternal, importedThroughInternal, reconcileBankInternal } from './import/queries';
import { listForeignMoney } from './import/transit';
import { formatEuro } from './ledger/cash-check';
import { getSetupStatus } from './ledger/setup';
import { listEntries } from './ledger/entries';
import { overdueOpenItemsInternal } from './ledger/open-items';
import { purposeBalancesAt } from './ledger/queries';
import { listVouchersWithoutEntry } from './ledger/vouchers';
import { financeAccounts, financeEntries, type FinanceAccountRow } from './schema';

/**
 * Die neun Kacheln der Startseite (F3b Task 6, F4 Task 6, Spec 9.7): je genau
 * ein Recht. `finance.todo` und `finance.setupIncomplete` sind in der
 * Vorgabe an — die übrigen Einzelkacheln (Beleg, Entwürfe, offene Zahlungen,
 * Zwecke, Import) bleiben aus, weil die Sammelkachel sie trägt.
 */

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Entwürfe ab 14 Tagen sind „zu alt“ (Entschieden 3, F3b) — ab Tag 15, fester Wert. */
const STALE_DRAFT_DAYS = 14;

/** Ganze Tage zwischen zwei Datumsangaben (`YYYY-MM-DD`), für „letzter Auszug vor N Tagen“ (F4 Task 6). */
function daysBetween(today: string, date: string): number {
  return Math.round((Date.parse(`${today}T00:00:00.000Z`) - Date.parse(`${date}T00:00:00.000Z`)) / 86_400_000);
}

/** Aktive Bank- und Zahlungsdienstkonten — nur diese kennen einen Auszug (Spec 9.3, 9.7). */
function activeReconcilableAccounts(deps: Parameters<DashboardTile['load']>[0]): FinanceAccountRow[] {
  return deps.db.select().from(financeAccounts).where(and(eq(financeAccounts.isActive, true), or(eq(financeAccounts.kind, 'bank'), eq(financeAccounts.kind, 'paymentService')))).all();
}

const todoTile: DashboardTile<Record<string, never>> = {
  key: 'todo',
  permission: 'finance.read',
  kind: 'list',
  defaultOn: true,
  options: z.object({}),
  messageKeys: ['reviewedNotFinal', 'withoutVoucher', 'overdueItems', 'rawOpen', 'foreignMoney', 'vouchersWithoutEntry', 'lastStatement'],
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
    const overdue = overdueOpenItemsInternal(deps.db, today, 'payable');
    if (overdue.length > 0) {
      const sumCents = overdue.reduce((s, i) => s + i.openCents, 0);
      lines.push({ titleKey: 'overdueItems', values: { count: overdue.length, sum: formatEuro(sumCents) }, href: '/finance/open-items?tab=payable' });
    }

    // F4 Task 6: Kontoumsätze ohne Zuordnung — ohne Namen, nur die Zahl. Seit F5 in die Arbeitsliste.
    const openRaw = countOpenRawTransactionsInternal(deps.db);
    if (openRaw > 0) lines.push({ titleKey: 'rawOpen', values: { count: openRaw }, href: '/finance/work' });

    // F5: Geld, das nicht dem Verein gehört und noch nicht weitergegeben ist — nur die Zahl, nie „für wen“.
    const foreign = await listForeignMoney(deps, ctx);
    if (foreign.ok && foreign.value.items.length > 0) lines.push({ titleKey: 'foreignMoney', values: { count: foreign.value.items.length }, href: '/finance/work/foreign' });

    // F5: Finanzbelege der Akte ohne Buchung — was der Aufrufer in der Akte nicht lesen darf, zählt die Akte nicht mit.
    const vouchers = await listVouchersWithoutEntry(deps, ctx, { limit: 1 });
    if (vouchers.ok && vouchers.value.total > 0) lines.push({ titleKey: 'vouchersWithoutEntry', values: { count: vouchers.value.total }, href: '/finance/work/vouchers' });

    // F4 Task 6: der älteste noch ausstehende Auszug — nur ein Konto, das schon einmal importiert
    // hat, kennt ein „vor N Tagen“; ein Konto ohne jeden Import zeigt die Checkliste, nicht diese Zeile.
    const warnDays = readSetting<number>(deps, 'finance.lastStatementWarnDays');
    const daysSinceOldestStatement = activeReconcilableAccounts(deps).reduce<number | null>((max, a) => {
      const through = importedThroughInternal(deps.db, a.id);
      if (through === null) return max;
      const days = daysBetween(today, through);
      return max === null || days > max ? days : max;
    }, null);
    if (daysSinceOldestStatement !== null && daysSinceOldestStatement >= warnDays) {
      lines.push({ titleKey: 'lastStatement', values: { days: daysSinceOldestStatement }, href: '/finance/imports' });
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
    const overdue = overdueOpenItemsInternal(deps.db, today);
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
    // F4 Task 6: ein offener optionaler Schritt (`importFormat`) zaehlt hier nicht mit.
    const open = res.ok ? res.value.steps.filter((s) => s.required && !s.done).length : 0;
    if (open === 0) return { kind: 'status', tone: 'neutral', messageKey: 'complete', href: '/admin/finance?panel=checklist' };
    return { kind: 'status', tone: 'warning', messageKey: 'incomplete', values: { count: open }, href: '/admin/finance?panel=checklist' };
  },
};

/** F4 Task 6, Spec 9.7 „Umsätze ohne Zuordnung“. */
const rawOpenTile: DashboardTile<Record<string, never>> = {
  key: 'rawOpen',
  permission: 'finance.read',
  kind: 'count',
  defaultOn: false,
  options: z.object({}),
  load(deps) {
    return { kind: 'count', count: countOpenRawTransactionsInternal(deps.db), href: '/finance/imports' };
  },
};

/** F4 Task 6, Spec 9.7 „Saldodifferenz“ — warnt, sobald ein Konto vom Auszug abweicht. */
const balanceDifferenceTile: DashboardTile<Record<string, never>> = {
  key: 'balanceDifference',
  permission: 'finance.read',
  kind: 'status',
  defaultOn: false,
  options: z.object({}),
  messageKeys: ['ok', 'differs'],
  load(deps) {
    const today = isoDay(deps.clock.now().getTime());
    const differing = activeReconcilableAccounts(deps).filter((a) => reconcileBankInternal(deps.db, a.id, today).state === 'differs');
    if (differing.length === 0) return { kind: 'status', tone: 'neutral', messageKey: 'ok', href: '/finance/imports' };
    return { kind: 'status', tone: 'warning', messageKey: 'differs', values: { count: differing.length }, href: '/finance/imports' };
  },
};

/** F4 Task 6, Spec 9.7 „letzter Auszug“ — warnt ab `finance.lastStatementWarnDays`, auch für ein Konto ohne jeden Import. */
const lastStatementTile: DashboardTile<Record<string, never>> = {
  key: 'lastStatement',
  permission: 'finance.read',
  kind: 'status',
  defaultOn: false,
  options: z.object({}),
  messageKeys: ['ok', 'stale'],
  load(deps) {
    const today = isoDay(deps.clock.now().getTime());
    const warnDays = readSetting<number>(deps, 'finance.lastStatementWarnDays');
    const stale = activeReconcilableAccounts(deps).filter((a) => {
      const through = importedThroughInternal(deps.db, a.id);
      return through === null || daysBetween(today, through) >= warnDays;
    });
    if (stale.length === 0) return { kind: 'status', tone: 'neutral', messageKey: 'ok', href: '/finance/imports' };
    return { kind: 'status', tone: 'warning', messageKey: 'stale', values: { count: stale.length }, href: '/finance/imports' };
  },
};

export const FINANCE_DASHBOARD_TILES: readonly DashboardTile[] = [
  todoTile as DashboardTile,
  withoutVoucherTile as DashboardTile,
  staleDraftsTile as DashboardTile,
  overdueItemsTile as DashboardTile,
  purposesNegativeTile as DashboardTile,
  setupIncompleteTile as DashboardTile,
  rawOpenTile as DashboardTile,
  balanceDifferenceTile as DashboardTile,
  lastStatementTile as DashboardTile,
];
