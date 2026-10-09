import { writeSettingInternal } from '@kompass/core';
import { createTestDeps, systemContext } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { dateFormatOf } from '@/lib/date-format';

const set = (deps: ReturnType<typeof createTestDeps>, key: string, value: unknown) =>
  deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), key, value));

describe('dateFormatOf — die Anzeige auf Server-Seiten', () => {
  it('liest ui.dateFormat und organization.timeZone, wie die Schale für useDateFormat', () => {
    const deps = createTestDeps();
    expect(dateFormatOf(deps)).toMatchObject({ mode: 'locale', timeZone: 'Europe/Berlin' });
    set(deps, 'ui.dateFormat', 'iso');
    set(deps, 'organization.timeZone', 'America/New_York');
    expect(dateFormatOf(deps)).toMatchObject({ mode: 'iso', timeZone: 'America/New_York' });
  });

  it('ein Zeitstempel wird zum Tag des Vereins, nicht zum UTC-Tag', () => {
    const deps = createTestDeps();
    expect(dateFormatOf(deps).date('2026-09-12T22:30:00Z')).toBe('13.09.2026');
    expect(dateFormatOf(deps).dateTime('2026-09-12T22:30:00Z')).toBe('13.09.2026, 00:30');
    set(deps, 'organization.timeZone', 'America/New_York');
    expect(dateFormatOf(deps).date('2026-09-12T22:30:00Z')).toBe('12.09.2026');
  });

  it('dateTime mit Sekunden für das Protokoll', () => {
    const deps = createTestDeps();
    set(deps, 'ui.dateFormat', 'iso');
    expect(dateFormatOf(deps).dateTime('2026-09-12T15:35:07.000Z', { seconds: true })).toBe('2026-09-12 17:35:07');
  });
});
