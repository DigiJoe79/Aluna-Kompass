import { describe, expect, it } from 'vitest';
import { isoDayInZone, type IsoDay } from '../src/dates';
import { planRetention, selectPrunable, type BackupRetention, type RingCounts } from '../src/backup/ring';
import type { BackupListItem, BackupListKind } from '../src/backup/sidecar';

const TZ = 'Europe/Berlin';
const RING: RingCounts = { daily: 7, weekly: 4, monthly: 12 };
const NOW = '2026-10-23T10:00:00.000Z';
const TODAY = '2026-10-23' as IsoDay;

function item(name: string, kind: BackupListKind, createdAt: string, status: 'passed' | 'failed' | 'unverified' = 'passed', pinned = false): BackupListItem {
  return {
    version: 1,
    name,
    kind,
    createdAt,
    sizeBytes: 1,
    sha256: null,
    manifest: null,
    verification: status === 'passed' ? { status, at: createdAt } : status === 'failed' ? { status, at: createdAt, reason: 'backupCorrupt' } : { status },
    pinned,
    pinnedLabel: null,
    hasSidecar: true,
  };
}
const isoMinusDays = (iso: string, n: number) => new Date(Date.parse(iso) - n * 86_400_000).toISOString();
const isoPlusDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86_400_000).toISOString();
const dayOf = (iso: string) => isoDayInZone(new Date(iso), TZ);
const plusDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

describe('Ring', () => {
  it('hält 7 Tage, 4 Wochen, 12 Monate, je Eimer das neueste', () => {
    const items = Array.from({ length: 400 }, (_, i) => item(`a${i}`, 'automatic', isoMinusDays('2026-10-23T01:00:00Z', i)));
    const byName = new Map(items.map((i) => [i.name, i]));
    const pruned = selectPrunable(items, RING, TZ, TODAY);
    const keep = items.map((i) => i.name).filter((n) => !pruned.includes(n));
    expect(keep.slice(0, 7)).toEqual(['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6']);
    expect(keep.length).toBeLessThanOrEqual(7 + 4 + 12);
    expect(new Set(keep.map((n) => dayOf(byName.get(n)!.createdAt).slice(0, 7))).size).toBe(12);
  });

  it('Prognose und Aufräumen stimmen über 400 simulierte Nächte überein', () => {
    let present: BackupListItem[] = [];
    const firstUntil = new Map<string, string>();
    const fellOn = new Map<string, string>();
    for (let night = 0; night < 400; night++) {
      const createdAt = isoPlusDays('2026-01-01T01:30:00Z', night);
      const today = dayOf(createdAt);
      const fresh = item(`n${night}`, 'automatic', createdAt);
      present = [fresh, ...present];
      const pruned = new Set(selectPrunable(present, RING, TZ, today));
      for (const name of pruned) fellOn.set(name, today);
      present = present.filter((i) => !pruned.has(i.name));
      const plan = planRetention(present, RING, TZ, today).get(fresh.name);
      if (plan?.kind !== 'until') throw new Error(`keine Prognose für ${fresh.name}: ${JSON.stringify(plan)}`);
      firstUntil.set(fresh.name, plan.until);
    }
    expect(fellOn.size).toBeGreaterThan(300);
    for (const [name, day] of fellOn) expect(day, name).toBe(plusDays(firstUntil.get(name)!, 1));
  });

  it('Prognose: Mittwoch → bis +6 Tage (täglich); Sonntag → als Wochenstand bis Sonntag + 21 Tage; Monatsletzter → als Monatsstand bis Monatsende + 11 Monate', () => {
    expect(planRetention([item('mi', 'automatic', '2026-10-21T01:00:00Z')], RING, TZ, '2026-10-21' as IsoDay).get('mi')).toEqual({ kind: 'until', until: '2026-10-27', tier: 'daily' });
    expect(planRetention([item('so', 'automatic', '2026-10-25T02:00:00Z')], RING, TZ, '2026-10-25' as IsoDay).get('so')).toEqual({ kind: 'until', until: '2026-11-15', tier: 'weekly' });
    expect(planRetention([item('ul', 'automatic', '2026-10-31T02:00:00Z')], RING, TZ, '2026-10-31' as IsoDay).get('ul')).toEqual({ kind: 'until', until: '2027-09-30', tier: 'monthly' });
  });

  it('zwei automatische am selben Vereinstag: das ältere fällt', () => {
    // 23:30Z am 21.10. ist in Berlin schon der 22.10., wie 01:00Z am 22.10.
    const items = [item('spaet', 'automatic', '2026-10-22T01:00:00Z'), item('frueh', 'automatic', '2026-10-21T23:30:00Z')];
    expect(selectPrunable(items, RING, TZ, TODAY)).toEqual(['frueh']);
  });

  it('gescheiterte und ungeprüfte automatische zählen nicht; ohne neueres geprüftes untilNextVerified, sonst prune', () => {
    const items = [
      item('kaputt', 'automatic', isoMinusDays(NOW, 1), 'failed'),
      item('gut', 'automatic', isoMinusDays(NOW, 2)),
      item('alt-kaputt', 'automatic', isoMinusDays(NOW, 3), 'unverified'),
      item('gut2', 'automatic', isoMinusDays(NOW, 4)),
    ];
    const plan = planRetention(items, RING, TZ, TODAY);
    expect(plan.get('kaputt')).toEqual({ kind: 'untilNextVerified' });
    expect(plan.get('alt-kaputt')).toEqual({ kind: 'prune' });
    expect(plan.get('gut')).toMatchObject({ kind: 'until' });
    expect(plan.get('gut2')).toMatchObject({ kind: 'until' });
    // Ein gescheitertes verdrängt kein geprüftes: sieben gescheiterte neuere lassen das geprüfte im Ring.
    const many = [...Array.from({ length: 7 }, (_, i) => item(`f${i}`, 'automatic', isoMinusDays(NOW, i), 'failed')), item('ok', 'automatic', isoMinusDays(NOW, 7))];
    expect(selectPrunable(many, RING, TZ, TODAY)).not.toContain('ok');
  });

  it('Von Hand: das vorige fällt erst, wenn ein neueres bestanden hat', () => {
    const T1 = isoMinusDays(NOW, 3);
    const T2 = isoMinusDays(NOW, 2);
    const T3 = isoMinusDays(NOW, 1);
    const items = [item('m2', 'manual', T2, 'failed'), item('m1', 'manual', T1)];
    expect(selectPrunable(items, RING, TZ, TODAY)).toEqual([]);
    expect(planRetention(items, RING, TZ, TODAY).get('m1')).toEqual({ kind: 'untilNextManual' });
    expect(selectPrunable([item('m3', 'manual', T3), ...items], RING, TZ, TODAY).sort()).toEqual(['m1', 'm2']);
  });

  it.each(['preUpdate', 'preRestore', 'upload'] as const)('%s: 30 Tage, das neueste geprüfte bleibt immer', (kind) => {
    const items = [item('neu', kind, isoMinusDays(NOW, 40)), item('alt', kind, isoMinusDays(NOW, 45)), item('jung', kind, isoMinusDays(NOW, 41), 'failed'), item('frisch', kind, isoMinusDays(NOW, 5), 'failed')];
    const plan = planRetention(items, RING, TZ, TODAY);
    expect(plan.get('neu')).toEqual({ kind: 'untilNewer', notBefore: plusDays(dayOf(isoMinusDays(NOW, 40)), 30) });
    expect(plan.get('alt')).toEqual({ kind: 'prune' });
    expect(plan.get('jung')).toEqual({ kind: 'prune' });
    expect(plan.get('frisch')).toEqual({ kind: 'until', until: plusDays(dayOf(isoMinusDays(NOW, 5)), 30), tier: 'age' });
  });

  it('festgehaltene → pinned, unbekannte → kept; beide zählen nicht mit', () => {
    const items = [
      item('fest', 'automatic', isoMinusDays(NOW, 0), 'passed', true),
      item('fremd', 'unknown', isoMinusDays(NOW, 300), 'unverified'),
      item('a1', 'automatic', isoMinusDays(NOW, 0)),
      item('fest-alt', 'manual', isoMinusDays(NOW, 500), 'passed', true),
      item('m', 'manual', isoMinusDays(NOW, 1)),
    ];
    const plan = planRetention(items, RING, TZ, TODAY);
    expect(plan.get('fest')).toEqual({ kind: 'pinned' } satisfies BackupRetention);
    expect(plan.get('fest-alt')).toEqual({ kind: 'pinned' });
    expect(plan.get('fremd')).toEqual({ kind: 'kept' });
    // Das festgehaltene verdrängt das gleichtägige automatische nicht, und es zählt nicht als „neueres Von Hand“.
    expect(plan.get('a1')).toMatchObject({ kind: 'until', tier: 'daily' });
    expect(plan.get('m')).toEqual({ kind: 'untilNextManual' });
  });
});
