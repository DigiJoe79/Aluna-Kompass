import { describe, expect, it } from 'vitest';
import type { Deps } from '../src/deps';
import { messageDate, messageDateMode, messageDateTime } from '../src/message-date';
import { writeSettingInternal } from '../src/settings/service';
import { createTestDeps, systemContext } from '../src/testing';

const set = (deps: ReturnType<typeof createTestDeps>, key: string, value: unknown) =>
  deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), key, value));

describe('messageDate', () => {
  it('schreibt das Datum wie die Oberfläche — ohne Einstellung deutsch', () => {
    expect(messageDate(createTestDeps(), '2026-09-12')).toBe('12.09.2026');
  });

  it('folgt ui.dateFormat = iso', () => {
    const deps = createTestDeps();
    set(deps, 'ui.dateFormat', 'iso');
    expect(messageDate(deps, '2026-09-12')).toBe('2026-09-12');
  });

  it('macht aus einem Zeitstempel den Tag des Vereins (isoDayIn), nicht den UTC-Tag', () => {
    const deps = createTestDeps();
    expect(messageDate(deps, '2026-09-12T22:30:00Z')).toBe('13.09.2026');
    set(deps, 'organization.timeZone', 'America/New_York');
    expect(messageDate(deps, '2026-09-12T22:30:00Z')).toBe('12.09.2026');
  });

  it('gibt bei nichts nichts zurück', () => {
    expect(messageDate(createTestDeps(), null)).toBe('');
  });

  it('kennt die Registry die Einstellung nicht, bleibt es beim Datum aus der Sprache', () => {
    const deps = createTestDeps();
    const partial = { db: deps.db, registry: { ...deps.registry, settingDefinitions: new Map() } } as unknown as Pick<Deps, 'db' | 'registry'>;
    expect(messageDate(partial, '2026-09-12')).toBe('12.09.2026');
    expect(messageDateTime(partial, '2026-09-12T15:35:00.000Z')).toBe('12.09.2026, 17:35');
  });
});

describe('messageDateTime', () => {
  it('schreibt Datum und Uhrzeit in der Zeitzone des Vereins', () => {
    expect(messageDateTime(createTestDeps(), '2026-09-12T15:35:00.000Z')).toBe('12.09.2026, 17:35');
  });

  it('folgt ui.dateFormat = iso', () => {
    const deps = createTestDeps();
    set(deps, 'ui.dateFormat', 'iso');
    expect(messageDateTime(deps, '2026-09-12T15:35:00.000Z')).toBe('2026-09-12 17:35');
  });

  it('folgt organization.timeZone', () => {
    const deps = createTestDeps();
    set(deps, 'organization.timeZone', 'America/New_York');
    expect(messageDateTime(deps, '2026-09-12T15:35:00.000Z')).toBe('12.09.2026, 11:35');
  });

  it('gibt bei nichts nichts zurück', () => {
    expect(messageDateTime(createTestDeps(), undefined)).toBe('');
  });
});

describe('messageDateMode', () => {
  it('lässt nur iso stehen — jeder andere Modus wird ein absolutes Datum', () => {
    expect(messageDateMode('iso')).toBe('iso');
    expect(messageDateMode('locale')).toBe('locale');
    expect(messageDateMode('relative')).toBe('locale');
    expect(messageDateMode(undefined)).toBe('locale');
  });
});
