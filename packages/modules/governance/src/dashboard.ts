import { todayIn, type DashboardContent, type DashboardLine, type DashboardTile } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { GOVERNANCE_DEADLINE_KINDS, governanceDeadlinesInternal } from './deadlines/list';
import { resolveRule } from './rules/resolve';
import { governanceOrgans } from './schema';
import { statuteRulesOnInternal } from './statutes';

/**
 * Kachel „Gremien: Fristen“ (Spec § 11, Art Fällig): je Frist eine Zeile mit Datum und Ziel. Seit U2 eingeschaltet,
 * weil jede Frist ein Ziel hat (**Claude**). Die fehlende ordentliche Versammlung steht in der Warnung, nicht hier.
 */
const deadlinesTile: DashboardTile<Record<string, never>> = {
  key: 'deadlines',
  permission: 'governance.read',
  kind: 'list',
  variant: 'due',
  defaultOn: true,
  options: z.object({}),
  // Alle Arten, auch die hier ausgefilterte: Die Übersicht der Gremien listet jede Frist mit diesen Texten.
  messageKeys: [...GOVERNANCE_DEADLINE_KINDS],
  load(deps) {
    const lines: DashboardLine[] = governanceDeadlinesInternal(deps, todayIn(deps))
      .filter((d) => d.kind !== 'ordinaryMeetingMissing')
      .map((d) => ({
        ...(d.dueOn ? { date: d.dueOn } : {}),
        titleKey: d.kind,
        values: d.params,
        href: d.href,
        ...(d.overdue ? { overdue: true } : {}),
      }));
    return { kind: 'list', lines, total: lines.length, href: null };
  },
};

/**
 * Warnung „Ordentliche Mitgliederversammlung … noch nicht angesetzt“ (Board 9a, Designer Phase 2): ab dem Stichtag
 * `governance.ordinaryMeetingWarnFrom`, nur wenn die Satzung eine im Jahr verlangt. Sonst Ruhe.
 */
const ordinaryMeetingTile: DashboardTile<Record<string, never>> = {
  key: 'ordinaryMeeting',
  permission: 'governance.read',
  kind: 'status',
  warningAction: true,
  defaultOn: true,
  options: z.object({}),
  messageKeys: ['missing', 'fine'],
  load(deps): DashboardContent {
    const today = todayIn(deps);
    const year = Number(today.slice(0, 4));
    const missing = governanceDeadlinesInternal(deps, today).find((d) => d.kind === 'ordinaryMeetingMissing');
    if (!missing) return { kind: 'status', tone: 'neutral', messageKey: 'fine', values: { year }, href: '/governance/meetings' };
    const assembly = deps.db.select().from(governanceOrgans).where(eq(governanceOrgans.kind, 'assembly')).get()!;
    const rule = resolveRule(statuteRulesOnInternal(deps.db, today).rules, assembly.id, 'ordinaryMeetingYearly');
    return { kind: 'status', tone: 'warning', messageKey: 'missing', values: { year, reference: rule.reference ?? 'none' }, href: missing.href };
  },
};

export const GOVERNANCE_DASHBOARD_TILES: readonly DashboardTile[] = [deadlinesTile as DashboardTile, ordinaryMeetingTile as DashboardTile];
