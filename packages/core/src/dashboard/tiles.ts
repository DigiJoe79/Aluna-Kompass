import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { roles, users } from '../db/schema';
import { listDueFollowUpsWithTargets } from '../follow-ups/targets';
import { listTranslationGaps } from '../i18n/translations';
import { listOpenInstallErrors } from '../modules/installs';
import { listModules } from '../modules/service';
import { collectRetentionDue } from '../retention/service';
import { readAllSettings, readSetting } from '../settings/service';
import { userNamesFor } from '../users/names';
import type { DashboardLine, DashboardTile } from './types';

/**
 * Was ein Verein eingetragen haben muss, bevor Kompass Rechenschaftsdokumente
 * erzeugen kann. War bis zur Dashboard-Spec `apps/kompass/src/lib/setup-progress.ts`.
 */
export const REQUIRED_SETTINGS = [
  'organization.name',
  'organization.street',
  'organization.postalCode',
  'organization.city',
  'organization.registerCourt',
  'organization.registerNumber',
  'organization.taxNumber',
  'organization.taxOffice',
  'organization.exemptionNoticeType',
  'organization.exemptionNoticeDate',
] as const;

/**
 * `organization.taxNumber` → `settingTaxNumber`: Meldungsschlüssel ohne Punkt,
 * weil next-intl den Punkt als Namensraumtrenner liest.
 */
export function settingMessageKey(key: string): string {
  const field = key.split('.')[1] ?? key;
  return `setting${field[0]!.toUpperCase()}${field.slice(1)}`;
}

function filled(key: string, value: unknown): boolean {
  if (key === 'organization.exemptionNoticeType') return typeof value === 'string' && value !== 'none';
  return typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined;
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const followUpsTile: DashboardTile<{ horizonDays: '7' | '14' | '30'; onlyMine: boolean }> = {
  key: 'followUps',
  permission: 'followUps.view',
  kind: 'list',
  defaultOn: true,
  options: z.object({ horizonDays: z.enum(['7', '14', '30']).default('7'), onlyMine: z.boolean().default(false) }),
  messageKeys: ['protectedTitle'],
  async load(deps, ctx, o) {
    const now = deps.clock.now().getTime();
    const today = isoDay(now);
    const until = isoDay(now + Number(o.horizonDays) * 86_400_000);
    const filter = o.onlyMine && ctx.userId ? { until, assigneeUserId: ctx.userId } : { until };
    const res = await listDueFollowUpsWithTargets(deps, ctx, filter);
    if (!res.ok) return { kind: 'list', lines: [], total: 0, href: null };
    const names = userNamesFor(deps, res.value.map((r) => r.assigneeUserId));
    const lines: DashboardLine[] = res.value.slice(0, 10).map((r) => {
      const line: DashboardLine = r.titleHidden
        ? { date: r.dueAt, titleKey: 'protectedTitle', overdue: r.dueAt < today }
        : { date: r.dueAt, title: r.title, overdue: r.dueAt < today, action: { kind: 'completeFollowUp', followUpId: r.id } };
      if (r.target) line.link = { label: r.target.label, href: r.target.href };
      const name = r.assigneeUserId ? names.get(r.assigneeUserId) : undefined;
      if (name) line.extra = name;
      return line;
    });
    return { kind: 'list', lines, total: res.value.length, href: null };
  },
};

const setupTile: DashboardTile<Record<string, never>> = {
  key: 'setup',
  permission: 'settings.manage',
  kind: 'list',
  defaultOn: true,
  options: z.object({}),
  messageKeys: [...REQUIRED_SETTINGS.map(settingMessageKey), 'noRole', 'noModule', 'installError'],
  load(deps) {
    const all = readAllSettings(deps);
    const lines: DashboardLine[] = REQUIRED_SETTINGS.filter((key) => !filled(key, all[key])).map((key) => ({ titleKey: settingMessageKey(key), href: '/admin/settings' }));
    const others = deps.db.select({ id: roles.id }).from(roles).where(eq(roles.isProtected, false)).all();
    if (others.length === 0) lines.push({ titleKey: 'noRole', href: '/admin/roles' });
    const modules = listModules(deps).filter((m) => m.key !== 'core');
    if (modules.length > 0 && !modules.some((m) => m.enabled)) lines.push({ titleKey: 'noModule', href: '/admin/modules' });
    for (const e of listOpenInstallErrors(deps)) lines.push({ titleKey: 'installError', values: { module: e.module, message: e.message }, href: '/admin/modules' });
    return { kind: 'list', lines, total: lines.length, href: null };
  },
};

const backupTile: DashboardTile<Record<string, never>> = {
  key: 'backup',
  permission: 'backup.export',
  kind: 'status',
  defaultOn: true,
  options: z.object({}),
  messageKeys: ['never', 'stale', 'recent'],
  load(deps) {
    const last = readSetting<string | null>(deps, 'system.lastExportAt');
    if (!last) return { kind: 'status', tone: 'warning', messageKey: 'never', href: '/admin/backup' };
    const days = Math.floor((deps.clock.now().getTime() - new Date(last).getTime()) / 86_400_000);
    const maxAge = readSetting<number>(deps, 'backup.maxAgeDays');
    if (days > maxAge) return { kind: 'status', tone: 'warning', messageKey: 'stale', values: { days }, href: '/admin/backup' };
    return { kind: 'status', tone: 'neutral', messageKey: 'recent', values: { days }, href: '/admin/backup' };
  },
};

const accountsTile: DashboardTile<Record<string, never>> = {
  key: 'accounts',
  permission: 'users.manage',
  kind: 'count',
  defaultOn: false,
  options: z.object({}),
  load(deps) {
    const now = deps.clock.now().toISOString();
    const rows = deps.db.select({ mustChangePassword: users.mustChangePassword, lockedUntil: users.lockedUntil }).from(users).where(and(eq(users.isActive, true))).all();
    const count = rows.filter((r) => r.mustChangePassword || (r.lockedUntil !== null && r.lockedUntil > now)).length;
    return { kind: 'count', count, href: '/admin/users' };
  },
};

const retentionTile: DashboardTile<Record<string, never>> = {
  key: 'retention',
  permission: 'retention.view',
  kind: 'count',
  defaultOn: true,
  options: z.object({}),
  load: (deps) => ({ kind: 'count', count: collectRetentionDue(deps).length, href: '/admin/retention' }),
};

const translationsTile: DashboardTile<Record<string, never>> = {
  key: 'translations',
  permission: 'settings.manage',
  kind: 'count',
  defaultOn: false,
  options: z.object({}),
  async load(deps, ctx) {
    const res = await listTranslationGaps(deps, ctx);
    return { kind: 'count', count: res.ok ? res.value.gaps.length : 0, href: '/admin/locales' };
  },
};

export const CORE_DASHBOARD_TILES: readonly DashboardTile[] = [
  followUpsTile as DashboardTile,
  setupTile as DashboardTile,
  backupTile as DashboardTile,
  accountsTile as DashboardTile,
  retentionTile as DashboardTile,
  translationsTile as DashboardTile,
];
