import { describe, expect, it } from 'vitest';
import { liveTimeOn } from '@/lib/governance/clock';

const time = (iso: string) => new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Berlin' }).format(new Date(iso));

/**
 * Die Anwesenheit kennt nur Uhrzeiten des Sitzungstags (`HH:MM`). Nach Mitternacht lag „00:30“ vor jedem Kommen um
 * „19:00“: Der Mitlauf zählte niemanden mehr als anwesend, Beschlussfähigkeit und Mehrheiten kippten (Bildlauf 30.10.).
 * Ist der Sitzungstag vorbei, gilt das Ende des Sitzungstags.
 */
describe('liveTimeOn', () => {
  it('nimmt am Sitzungstag die Uhrzeit in der Vereinszone', () => {
    expect(liveTimeOn('2026-07-15T17:30:00.000Z', '2026-07-15', 'Europe/Berlin', time)).toBe('19:30');
  });

  it('nimmt nach dem Sitzungstag das Ende des Sitzungstags, auch kurz nach Mitternacht', () => {
    expect(liveTimeOn('2026-07-15T22:30:00.000Z', '2026-07-15', 'Europe/Berlin', time)).toBe('23:59');
    expect(liveTimeOn('2026-10-29T23:30:00.000Z', '2026-07-15', 'Europe/Berlin', time)).toBe('23:59');
  });
});
