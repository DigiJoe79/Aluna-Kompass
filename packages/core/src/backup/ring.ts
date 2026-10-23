import { isoDayInZone, type IsoDay } from '../dates';
import type { Deps } from '../deps';
import { readSetting } from '../settings/service';
import type { BackupListItem } from './sidecar';

/** Wie viele automatische Backups der Ring je Eimer hält (Einstellungen `backup.ring.*`). */
export interface RingCounts {
  daily: number;
  weekly: number;
  monthly: number;
}

/** Vor Update, Vor Einspielen und Hochgeladen bleiben so viele Tage; das jeweils neueste geprüfte bleibt immer. */
export const KIND_RETENTION_DAYS = 30;
/** Höchstens so viele festgehaltene Backups (Spec § Arten und Ring). */
export const BACKUP_PINNED_MAX = 3;
/** Kurzer Name beim Festhalten. */
export const BACKUP_PIN_LABEL_MAX = 60;

export type BackupRetention =
  | { kind: 'pinned' }
  | { kind: 'until'; until: IsoDay; tier: 'daily' | 'weekly' | 'monthly' | 'age' }
  | { kind: 'untilNextManual' }
  /** Neuestes geprüftes seiner Art (Vor Update, Vor Einspielen, Hochgeladen): bleibt, bis ein neueres geprüftes kommt. */
  | { kind: 'untilNewer'; notBefore: IsoDay }
  /** Automatisch, gescheitert oder ungeprüft, und noch kein neueres geprüftes. */
  | { kind: 'untilNextVerified' }
  /** Art `unknown`: wird nie automatisch entfernt. */
  | { kind: 'kept' }
  /** Fällt beim nächsten Aufräumen. */
  | { kind: 'prune' };

export function ringCountsOf(deps: Deps): RingCounts {
  return {
    daily: readSetting<number>(deps, 'backup.ring.daily'),
    weekly: readSetting<number>(deps, 'backup.ring.weekly'),
    monthly: readSetting<number>(deps, 'backup.ring.monthly'),
  };
}

// Tagesrechnung auf `JJJJ-MM-TT` in UTC: Zeitzonen spielen nur beim Zuordnen eines Zeitpunkts zum Vereinstag eine Rolle.
const DAY_MS = 86_400_000;
const utc = (day: string) => Date.parse(`${day}T00:00:00Z`);
const asDay = (ms: number) => new Date(ms).toISOString().slice(0, 10) as IsoDay;
const plusDays = (day: string, n: number): IsoDay => asDay(utc(day) + n * DAY_MS);
/** Sonntag der ISO-Woche (Montag bis Sonntag). */
const sundayOf = (day: string): IsoDay => {
  const weekday = (new Date(utc(day)).getUTCDay() + 6) % 7; // Montag 0 … Sonntag 6
  return plusDays(day, 6 - weekday);
};
/** ISO-Woche als `JJJJ-Www` nach der Donnerstagsregel: Die Woche gehört zum Jahr ihres Donnerstags. */
export function isoWeekOf(day: string): string {
  const thursday = plusDays(sundayOf(day), -3);
  const year = Number(thursday.slice(0, 4));
  const week = Math.floor((utc(thursday) - utc(`${year}-01-01`)) / DAY_MS / 7) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}
const monthEndOf = (month: string): IsoDay => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return asDay(Date.UTC(y, m, 0));
};
const plusMonths = (month: string, n: number): string => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const maxDay = (a: IsoDay, b: IsoDay): IsoDay => (a > b ? a : b);

const passed = (x: BackupListItem) => x.verification.status === 'passed';

/**
 * Für jedes Backup, bis wann es bleibt — **eine** Rechnung für die Anzeige und das Aufräumen; `selectPrunable` nimmt
 * nur die Einträge `prune` von hier, damit Prognose und Aufräumen nie auseinanderlaufen.
 *
 * Die Prognose nimmt an, dass der Zeitplan weiterläuft (Spec): Ein Mittwochsstand wird bis Sonntag von neueren
 * derselben Woche abgelöst und zählt deshalb nicht als Wochenstand; ein Stand vor Monatsende ebenso nicht als
 * Monatsstand. Festgehaltene, unbekannte, gescheiterte und ungeprüfte Backups zählen für keinen Eimer.
 */
export function planRetention(items: readonly BackupListItem[], ring: RingCounts, timeZone: string, today: IsoDay): Map<string, BackupRetention> {
  const plan = new Map<string, BackupRetention>();
  const dayOf = new Map<string, IsoDay>(items.map((x) => [x.name, isoDayInZone(new Date(x.createdAt), timeZone)]));
  const tag = (x: BackupListItem) => dayOf.get(x.name)!;
  const pool = [...items].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  const rest: BackupListItem[] = [];
  for (const x of pool) {
    if (x.pinned) plan.set(x.name, { kind: 'pinned' });
    else if (x.kind === 'unknown') plan.set(x.name, { kind: 'kept' });
    else rest.push(x);
  }

  // Von Hand: ein Platz. Das neueste geprüfte bleibt samt allen neueren (gescheiterten), bis ein neueres besteht.
  const manual = rest.filter((x) => x.kind === 'manual');
  const newestManual = manual.find(passed);
  for (const x of manual) {
    const keep = !newestManual || x.createdAt >= newestManual.createdAt;
    plan.set(x.name, keep ? { kind: 'untilNextManual' } : { kind: 'prune' });
  }

  // Vor Update, Vor Einspielen, Hochgeladen: 30 Tage, das neueste geprüfte bleibt immer.
  for (const kind of ['preUpdate', 'preRestore', 'upload'] as const) {
    const ofKind = rest.filter((x) => x.kind === kind);
    const newest = ofKind.find(passed);
    for (const x of ofKind) {
      const until = plusDays(tag(x), KIND_RETENTION_DAYS);
      if (x === newest) plan.set(x.name, { kind: 'untilNewer', notBefore: until });
      else plan.set(x.name, until < today ? { kind: 'prune' } : { kind: 'until', until, tier: 'age' });
    }
  }

  // Automatisch: je Eimer die ersten `anzahl` verschiedenen Schlüssel, je Schlüssel das neueste geprüfte.
  const automatic = rest.filter((x) => x.kind === 'automatic');
  const verified = automatic.filter(passed);
  const week = (x: BackupListItem) => isoWeekOf(tag(x));
  const month = (x: BackupListItem) => tag(x).slice(0, 7);
  const newestPer = (key: (x: BackupListItem) => string, count: number): Set<BackupListItem> => {
    const seen = new Set<string>();
    const chosen = new Set<BackupListItem>();
    for (const x of verified) {
      if (seen.size >= count && !seen.has(key(x))) break;
      if (seen.has(key(x))) continue;
      seen.add(key(x));
      chosen.add(x);
    }
    return chosen;
  };
  const daily = newestPer(tag, ring.daily);
  const weekly = newestPer(week, ring.weekly);
  const monthly = newestPer(month, ring.monthly);
  const newestOf = (key: (x: BackupListItem) => string) => {
    const first = new Map<string, BackupListItem>();
    for (const x of verified) if (!first.has(key(x))) first.set(key(x), x);
    return (x: BackupListItem) => first.get(key(x)) === x;
  };
  const newestOfDay = newestOf(tag);
  const newestOfWeek = newestOf(week);
  const newestOfMonth = newestOf(month);

  for (const x of automatic) {
    if (!passed(x)) {
      const newer = verified.some((v) => v.createdAt > x.createdAt);
      plan.set(x.name, newer ? { kind: 'prune' } : { kind: 'untilNextVerified' });
      continue;
    }
    if (!daily.has(x) && !weekly.has(x) && !monthly.has(x)) {
      plan.set(x.name, { kind: 'prune' });
      continue;
    }
    const day = tag(x);
    const candidates: { until: IsoDay; tier: 'daily' | 'weekly' | 'monthly' }[] = [];
    if (ring.daily > 0 && newestOfDay(x)) candidates.push({ until: plusDays(day, ring.daily - 1), tier: 'daily' });
    const sunday = sundayOf(day);
    if (ring.weekly > 0 && newestOfWeek(x) && (today > sunday || day === sunday)) candidates.push({ until: plusDays(sunday, 7 * (ring.weekly - 1)), tier: 'weekly' });
    const monthEnd = monthEndOf(month(x));
    if (ring.monthly > 0 && newestOfMonth(x) && (today > monthEnd || day === monthEnd)) candidates.push({ until: monthEndOf(plusMonths(month(x), ring.monthly - 1)), tier: 'monthly' });
    const best = candidates.reduce<{ until: IsoDay; tier: 'daily' | 'weekly' | 'monthly' } | null>((a, b) => (a === null || b.until > a.until ? b : a), null);
    plan.set(x.name, { kind: 'until', until: maxDay(best?.until ?? today, today), tier: best?.tier ?? 'daily' });
  }
  return plan;
}

/** Was das Aufräumen entfernt: genau die Einträge `prune` aus `planRetention`. */
export function selectPrunable(items: readonly BackupListItem[], ring: RingCounts, timeZone: string, today: IsoDay): string[] {
  return [...planRetention(items, ring, timeZone, today)].filter(([, r]) => r.kind === 'prune').map(([name]) => name);
}
