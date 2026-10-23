import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { backupScheduleOf, nightlyBackupMissing } from '../backup/schedule';
import { messageDateTime } from '../message-date';
import { newestVerifiedBackup } from '../backup/sidecar';
import { readBackupState } from '../backup/state';
import { backupStorageSync } from '../backup/storage';
import { roles, users } from '../db/schema';
import { listDueFollowUpsWithTargets } from '../follow-ups/targets';
import { listTranslationGaps } from '../i18n/translations';
import { listOpenInstallErrors } from '../modules/installs';
import { listModules } from '../modules/service';
import { collectRetentionDue } from '../retention/service';
import { readAllSettings, readSetting } from '../settings/service';
import { isoDayIn } from '../today';
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

const followUpsTile: DashboardTile<{ horizonDays: '7' | '14' | '30'; onlyMine: boolean }> = {
  key: 'followUps',
  permission: 'followUps.view',
  kind: 'list',
  variant: 'due',
  defaultOn: true,
  options: z.object({ horizonDays: z.enum(['7', '14', '30']).default('7'), onlyMine: z.boolean().default(false) }),
  messageKeys: ['protectedTitle'],
  async load(deps, ctx, o) {
    const now = deps.clock.now().getTime();
    const today = isoDayIn(deps, now);
    const until = isoDayIn(deps, now + Number(o.horizonDays) * 86_400_000);
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
  warningAction: true,
  defaultOn: true,
  options: z.object({}),
  messageKeys: ['never', 'stale', 'recent', 'failed', 'notMounted', 'nightlyMissing', 'storageLow'],
  load(deps) {
    // Vorrang (Spec Backup § Meldungen): letzter Fehler > nicht eingehängt > nächtliches fehlt > Platz knapp > Frist.
    // Die Sätze nennen den letzten geprüften Stand mit Zeit statt „vor n Tagen“ (Designer Backup § 7, 5a–5c).
    const warn = (messageKey: string, values?: Record<string, string | number>) =>
      ({ kind: 'status', tone: 'warning', messageKey, ...(values ? { values } : {}), href: '/admin/backup' }) as const;
    const bp = deps.backupPath ?? null;
    // Das neueste geprüfte Backup gleich welcher Art, aus dem Verzeichnis (Spec Backup § Zeitplan).
    const last = bp ? (newestVerifiedBackup(bp)?.createdAt ?? null) : null;
    const when = last ? messageDateTime(deps, last) : 'none';
    const schedule = backupScheduleOf(deps).enabled ? 'on' : 'off';
    const lastError = bp ? readBackupState(bp).lastError : null;
    if (lastError) return warn('failed', { kind: lastError.kind === 'automatic' ? 'automatic' : 'other', when });
    if (deps.backupMountWarning === 'notMounted') return warn('notMounted');
    if (nightlyBackupMissing(deps)) return warn('nightlyMissing', { when });
    if (bp && backupStorageSync(bp)?.low) return warn('storageLow');
    if (!last) return warn('never', { schedule });
    const days = Math.floor((deps.clock.now().getTime() - new Date(last).getTime()) / 86_400_000);
    const maxAge = readSetting<number>(deps, 'backup.maxAgeDays');
    if (days > maxAge) return warn('stale', { days, schedule });
    return { kind: 'status', tone: 'neutral', messageKey: 'recent', values: { when }, href: '/admin/backup' };
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
