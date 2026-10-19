import { readSetting, todayIn, type DashboardLine, type DashboardTile, type DbOrTx } from '@kompass/core';
import { unreturnedRunItemsInternal } from '@kompass/module-finance';
import { formatEuro } from '@kompass/module-finance/format';
import { isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { feeViewsInternal, liveCharges } from './fees';
import { memberMemberships } from './schema';
import type { DunningLevel } from './settings';
import { membershipStatus } from './status';

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * Handoff 2.8, Liste „Beitragsrückstände“: je Mitglied mit überfälligen Beiträgen eine Zeile — Name und Stufe (die
 * höchste erreichte, sonst „überfällig“), rechts der offene Betrag; sortiert nach Stufe, dann Betrag. Ruhe: „Alle
 * Beiträge bezahlt.“
 */
const arrearsTile: DashboardTile<Record<string, never>> = {
  key: 'arrears',
  permission: 'members.read',
  kind: 'list',
  variant: 'work',
  defaultOn: true,
  options: z.object({}),
  messageKeys: ['line', 'overdue'],
  load(deps) {
    const levels = readSetting<DunningLevel[]>(deps, 'members.dunningLevels');
    const leading = deps.locales()[0]!;
    const order = levels.map((l) => l.key);
    // R7: Ein Beitrag im eingereichten Einzug ist kein Rückstand (die Bank zieht ihn ein); ein gestundeter erst nach der
    // neuen Fälligkeit (`overdue` rechnet mit ihr, die Stufe zählt nach der Stundung neu).
    const inSubmittedRun = (openItemId: string | null) => !!openItemId && unreturnedRunItemsInternal(deps.db, { source: 'openItem', sourceId: openItemId, statuses: ['submitted'] }).length > 0;
    const views = feeViewsInternal(deps.db, deps, liveCharges(deps.db).filter((c) => c.state === 'created')).filter((f) => (f.overdue || f.dunningLevel !== null) && !inSubmittedRun(f.openItemId));
    const byMember = new Map<string, { name: string; sum: number; level: number }>();
    for (const f of views) {
      if (f.openCents <= 0) continue;
      const entry = byMember.get(f.membershipId) ?? { name: f.name, sum: 0, level: -1 };
      entry.sum += f.openCents;
      entry.level = Math.max(entry.level, f.dunningLevel ? order.indexOf(f.dunningLevel) : -1);
      byMember.set(f.membershipId, entry);
    }
    const lines: DashboardLine[] = [...byMember.entries()]
      .sort(([, a], [, b]) => b.level - a.level || b.sum - a.sum || a.name.localeCompare(b.name, 'de'))
      .map(([membershipId, e]): DashboardLine => {
        const level = e.level >= 0 ? levels[e.level]! : null;
        return level
          ? { titleKey: 'line', values: { name: e.name, level: level.name[leading] || Object.values(level.name)[0] || level.key }, trailing: formatEuro(e.sum), href: `/members/${membershipId}` }
          : { titleKey: 'overdue', values: { name: e.name }, trailing: formatEuro(e.sum), overdue: true, href: `/members/${membershipId}` };
      });
    return { kind: 'list', lines, total: lines.length, href: '/members/fees' };
  },
};

/** Handoff 2.8, Zahl „Offene Anträge“ mit „ältester seit n Tagen“. Ruhe: „Kein Antrag offen.“ */
const applicationsTile: DashboardTile<Record<string, never>> = {
  key: 'applications',
  permission: 'members.read',
  kind: 'count',
  defaultOn: true,
  options: z.object({}),
  messageKeys: ['oldest'],
  load(deps) {
    const today = todayIn(deps);
    const open = deps.db.select().from(memberMemberships).all().filter((m) => membershipStatus(m, today) === 'applied');
    const href = '/members?view=applications';
    if (open.length === 0) return { kind: 'count', count: 0, href };
    const oldest = open.map((m) => m.appliedOn ?? today).sort()[0]!;
    return { kind: 'count', count: open.length, href, note: { messageKey: 'oldest', values: { days: Math.max(0, daysBetween(oldest, today)) } } };
  },
};

/** Gibt es für das Jahr schon Beiträge? */
const feesExistFor = (db: DbOrTx, year: number) => liveCharges(db).some((c) => c.periodStart.startsWith(`${year}-`));

/**
 * Handoff 2.8, Warnung „Beiträge {Jahr}“ mit „Beiträge anlegen“: ab dem 1. Oktober für das nächste Jahr, sonst für das
 * laufende — solange es Mitglieder gibt und für das Jahr noch kein Beitrag angelegt ist.
 */
const feesYearTile: DashboardTile<Record<string, never>> = {
  key: 'feesYear',
  permission: 'members.fees',
  kind: 'status',
  warningAction: true,
  defaultOn: true,
  options: z.object({}),
  messageKeys: ['missing', 'ok'],
  load(deps) {
    const today = todayIn(deps);
    const year = Number(today.slice(0, 4)) + (today.slice(5) >= '10-01' ? 1 : 0);
    const href = `/members/fees?year=${year}`;
    const members = deps.db.select({ id: memberMemberships.id }).from(memberMemberships).where(isNotNull(memberMemberships.memberNumber)).all().length > 0;
    if (!members || feesExistFor(deps.db, year)) return { kind: 'status', tone: 'neutral', messageKey: 'ok', values: { year }, href };
    return { kind: 'status', tone: 'warning', messageKey: 'missing', values: { year }, href };
  },
};

export const MEMBERS_DASHBOARD_TILES: readonly DashboardTile[] = [arrearsTile as DashboardTile, applicationsTile as DashboardTile, feesYearTile as DashboardTile];

