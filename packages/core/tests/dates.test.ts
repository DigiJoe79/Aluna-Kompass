import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, isIsoDay, isoDay, paperDate, UI_DATE_LOCALE } from '../src/dates';
import { writeSettingInternal } from '../src/settings/service';
import { createTestDeps, systemContext } from '../src/testing';
import { isoDayIn } from '../src/today';

const BERLIN = 'Europe/Berlin';
const NEW_YORK = 'America/New_York';

describe('formatDate', () => {
  it('zeigt ein ISO-Datum aus der Sprache heraus — bei Deutsch mit Punkten', () => {
    expect(formatDate('2026-09-12', 'locale', BERLIN)).toBe('12.09.2026');
    expect(formatDate('2026-09-12', 'locale', BERLIN, 'en-GB')).toBe('12/09/2026');
  });

  it('lässt ISO 8601 stehen, wenn das eingestellt ist', () => {
    expect(formatDate('2026-09-12', 'iso', BERLIN)).toBe('2026-09-12');
  });

  it('ein reiner Tag bleibt derselbe Tag, in jeder Zone', () => {
    expect(formatDate('2026-09-12', 'locale', NEW_YORK)).toBe('12.09.2026');
    expect(formatDate('2026-01-01', 'iso', 'Pacific/Kiritimati')).toBe('2026-01-01');
  });

  it('ein Zeitstempel wird zum Tag in der Zone des Vereins, nicht zum UTC-Tag', () => {
    expect(formatDate('2026-09-12T22:30:00Z', 'locale', BERLIN)).toBe('13.09.2026');
    expect(formatDate('2026-09-12T22:30:00Z', 'iso', BERLIN)).toBe('2026-09-13');
    expect(formatDate('2026-09-12T22:30:00Z', 'locale', NEW_YORK)).toBe('12.09.2026');
    expect(formatDate('2026-09-12T22:30:00.000Z', 'iso', NEW_YORK)).toBe('2026-09-12');
  });

  it('lässt Unlesbares unverändert', () => {
    expect(formatDate('kaputt', 'locale', BERLIN)).toBe('kaputt');
  });

  it('gibt bei nichts nichts zurück', () => {
    expect(formatDate(null, 'locale', BERLIN)).toBe('');
    expect(formatDate('', 'iso', BERLIN)).toBe('');
  });
});

describe('formatDateTime', () => {
  it('zeigt Datum und Uhrzeit in der Zeitzone des Vereins', () => {
    expect(formatDateTime('2026-09-12T15:35:00.000Z', 'locale', BERLIN)).toBe('12.09.2026, 17:35');
    expect(formatDateTime('2026-09-12T15:35:00.000Z', 'iso', BERLIN)).toBe('2026-09-12 17:35');
  });

  it('nimmt die übergebene Zone, nicht fest Berlin', () => {
    expect(formatDateTime('2026-09-12T22:30:00Z', 'locale', NEW_YORK)).toBe('12.09.2026, 18:30');
    expect(formatDateTime('2026-09-12T22:30:00Z', 'iso', BERLIN)).toBe('2026-09-13 00:30');
  });

  it('lässt Unlesbares unverändert', () => {
    expect(formatDateTime('kaputt', 'locale', BERLIN)).toBe('kaputt');
  });
});

describe('isoDay', () => {
  it('nimmt einen Kalendertag an', () => {
    expect(isoDay('2026-09-12')).toBe('2026-09-12');
    expect(isIsoDay('2026-02-28')).toBe(true);
  });

  it('weist Zeitstempel, Unlesbares und Tage, die es nicht gibt, ab', () => {
    for (const bad of ['2026-09-12T22:30:00.000Z', '', 'kaputt', '12.09.2026', '2026-02-30', '2026-13-01']) {
      expect(isIsoDay(bad), bad).toBe(false);
      expect(() => isoDay(bad), bad).toThrow(/kein ISO-Tag/);
    }
  });
});

describe('paperDate', () => {
  it('schreibt fest TT.MM.JJJJ', () => {
    expect(paperDate(isoDay('2026-09-12'))).toBe('12.09.2026');
    expect(paperDate(isoDay('2026-01-01'))).toBe('01.01.2026');
  });

  it('ein Zeitstempel kommt nur über den Vereinstag aufs Papier: 22:30 UTC ist in Berlin schon der nächste Tag', () => {
    const deps = createTestDeps();
    expect(paperDate(isoDayIn(deps, Date.parse('2026-09-12T22:30:00Z')))).toBe('13.09.2026');
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'organization.timeZone', 'America/New_York'));
    expect(paperDate(isoDayIn(deps, Date.parse('2026-09-12T22:30:00Z')))).toBe('12.09.2026');
  });

  it('nimmt keinen rohen String — ein Zeitstempel ist ein Typfehler', () => {
    expect(() => paperDate(isoDay('2026-09-12T22:30:00Z'))).toThrow(/kein ISO-Tag/);
    // @ts-expect-error — ein string ist kein IsoDay (K10, Entscheidung Joe 2026-10-07)
    expect(paperDate('2026-09-12' as string)).toBe('12.09.2026');
  });
});

describe('dates.ts', () => {
  it('importiert nichts — die Oberfläche lädt die Datei im Browser (`@kompass/core/dates`)', () => {
    const text = readFileSync(path.resolve(import.meta.dirname, '../src/dates.ts'), 'utf8');
    expect([...text.matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)].map((m) => m[1])).toEqual([]);
  });

  it('die Sprache der Anzeige ist die, die die Oberfläche ohne Angabe nimmt', () => {
    expect(UI_DATE_LOCALE).toBe('de-DE');
    expect(formatDate('2026-09-12', 'locale', BERLIN)).toBe(formatDate('2026-09-12', 'locale', BERLIN, UI_DATE_LOCALE));
  });
});
