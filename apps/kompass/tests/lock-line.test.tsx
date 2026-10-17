import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { formatDate, formatTime, type DateFormatMode } from '@/lib/dates';
import { lockLineText } from '@/lib/finance/lock-line';
import messages from '../messages/de.json';

const fmt = (mode: DateFormatMode, timeZone: string) => ({ date: (v: string) => formatDate(v, mode, timeZone), time: (v: string) => formatTime(v, timeZone) });
const t = createTranslator({ locale: 'de', messages, namespace: 'finance.lockLine' });
const tc = createTranslator({ locale: 'de', messages, namespace: 'finance.channel' });

const line = (f: ReturnType<typeof fmt>, userName: string | null = 'Erika', channel: string | null = 'ui') =>
  lockLineText((key, values) => t(key, values), (key) => tc(key), { at: '2026-09-12T22:30:00Z', userName, channel }, f);

describe('lockLineText (Unterzeile einer festgeschriebenen Buchung, Runde 3, 089)', () => {
  it('nennt Tag und Uhrzeit in der Zone des Vereins, nicht den UTC-Tag', () => {
    const text = line(fmt('locale', 'Europe/Berlin'));
    expect(text).toContain('13.09.2026');
    expect(text).toContain('00:30');
    expect(text).toContain('Erika');
  });

  it('folgt Zone und Anzeige-Einstellung', () => {
    const text = line(fmt('iso', 'America/New_York'));
    expect(text).toContain('2026-09-12');
    expect(text).toContain('18:30');
  });

  it('ein unbekannter Kanal und eine gelöschte Person stehen als solche da', () => {
    expect(line(fmt('locale', 'Europe/Berlin'), null, null)).toBe(`festgeschrieben am 13.09.2026 um 00:30 von ${messages.finance.lockLine.unknownUser} (${messages.finance.channel.unknown})`);
  });
});
