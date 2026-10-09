import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatStamp, formatTime, isIsoDay, isoDay, paperDate, UI_DATE_LOCALE } from '../src/dates';
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

describe('formatDateTime mit Sekunden', () => {
  it('iso: JJJJ-MM-TT HH:mm:ss in der Zone des Vereins', () => {
    expect(formatDateTime('2026-09-12T15:35:07.000Z', 'iso', BERLIN, UI_DATE_LOCALE, { seconds: true })).toBe('2026-09-12 17:35:07');
  });

  it('locale: Sekunden aus derselben Formatierung, an der Stelle, die die Sprache vorgibt', () => {
    expect(formatDateTime('2026-09-12T15:35:07.000Z', 'locale', BERLIN, UI_DATE_LOCALE, { seconds: true })).toBe('12.09.2026, 17:35:07');
    const expected = new Intl.DateTimeFormat('en-US', { timeZone: BERLIN, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date('2026-09-12T15:35:07.000Z'));
    expect(formatDateTime('2026-09-12T15:35:07.000Z', 'locale', BERLIN, 'en-US', { seconds: true })).toBe(expected);
  });

  it('ohne Schalter wie bisher ohne Sekunden', () => {
    expect(formatDateTime('2026-09-12T15:35:07.000Z', 'iso', BERLIN)).toBe('2026-09-12 17:35');
  });
});

describe('formatTime', () => {
  it('fest HH:mm in 24 Stunden, in der Zone des Vereins, nicht in UTC', () => {
    expect(formatTime('2026-09-12T15:35:00.000Z', BERLIN)).toBe('17:35');
    expect(formatTime('2026-07-01T23:30:00Z', BERLIN)).toBe('01:30');
    expect(formatTime('2026-09-12T22:30:00Z', NEW_YORK)).toBe('18:30');
  });

  it('Mitternacht ist 00, nicht 24', () => {
    expect(formatTime('2026-09-12T22:00:00Z', BERLIN)).toBe('00:00');
  });

  it('Sommer- und Winterzeit', () => {
    expect(formatTime('2026-03-29T00:30:00Z', BERLIN)).toBe('01:30');
    expect(formatTime('2026-03-29T01:30:00Z', BERLIN)).toBe('03:30');
    expect(formatTime('2026-10-25T00:30:00Z', BERLIN)).toBe('02:30');
    expect(formatTime('2026-10-25T01:30:00Z', BERLIN)).toBe('02:30');
  });

  it('nimmt auch ein Date', () => {
    expect(formatTime(new Date('2026-09-12T15:35:00.000Z'), BERLIN)).toBe('17:35');
  });

  it('nichts → nichts, Unlesbares bleibt', () => {
    expect(formatTime(null, BERLIN)).toBe('');
    expect(formatTime('kaputt', BERLIN)).toBe('kaputt');
  });
});

describe('formatStamp', () => {
  const NOW = new Date('2026-09-13T08:00:00Z'); // 13.09., 10:00 in Berlin

  it('am selben Vereinstag nur die Uhrzeit', () => {
    expect(formatStamp('2026-09-13T06:20:00Z', 'locale', BERLIN, NOW)).toBe('08:20');
  });

  it('gestern: Datum und Uhrzeit, im eingestellten Format', () => {
    expect(formatStamp('2026-09-12T12:20:00Z', 'locale', BERLIN, NOW)).toBe('12.09.2026, 14:20');
    expect(formatStamp('2026-09-12T12:20:00Z', 'iso', BERLIN, NOW)).toBe('2026-09-12 14:20');
  });

  it('der Tag des Vereins zählt, nicht der UTC-Tag', () => {
    // 22:30 UTC am 12.09. ist in Berlin der 13.09., 00:30
    expect(formatStamp('2026-09-12T22:30:00Z', 'locale', BERLIN, NOW)).toBe('00:30');
    // um 23:00 Berliner Zeit am 12.09. ist derselbe Zeitpunkt noch morgen → Datum
    expect(formatStamp('2026-09-12T22:30:00Z', 'locale', BERLIN, new Date('2026-09-12T21:00:00Z'))).toBe('13.09.2026, 00:30');
  });

  it('ein Zeitpunkt kurz nach now (Uhren laufen auseinander) ist heute: HH:mm, nie relativ', () => {
    expect(formatStamp('2026-09-13T08:00:05Z', 'locale', BERLIN, NOW)).toBe('10:00');
  });

  it('nimmt now als Zahl und value als Date', () => {
    expect(formatStamp(new Date('2026-09-13T06:20:00Z'), 'iso', BERLIN, NOW.getTime())).toBe('08:20');
  });

  it('nichts → nichts, Unlesbares bleibt', () => {
    expect(formatStamp(undefined, 'locale', BERLIN, NOW)).toBe('');
    expect(formatStamp('kaputt', 'locale', BERLIN, NOW)).toBe('kaputt');
  });
});
