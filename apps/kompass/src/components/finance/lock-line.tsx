import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { DateFormatter } from '@/lib/date-format';
import { channelKey } from '@/lib/finance/channel';

function formatTime(value: string, { mode, timeZone }: DateFormatter): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(mode === 'iso' ? 'sv-SE' : 'de-DE', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

/**
 * Die Schloss-Zeile (HANDOFF § 2.5, Baustein 5): eine Tatsache, keine
 * Meldung. Nennt Datum, Uhrzeit, Person und Weg — die Kassenprüfung liest den
 * Weg als Auffälligkeit. Der Kanal kommt roh aus der Spalte (`ui`, `mcp`,
 * `system`, unbekannt oder `null`); `channelKey` entscheidet, nie diese
 * Komponente selbst — ein Seed- oder Hintergrundlauf erscheint nie still als
 * „Oberfläche“ (F3a-N Task 3).
 */
export function LockLine({ at, userName, channel, fmt }: { at: string; userName: string | null; channel: string | null; fmt: DateFormatter }) {
  const t = useTranslations('finance.lockLine');
  const tc = useTranslations('finance.channel');
  return (
    <p className="flex items-center gap-2 rounded-sm bg-final-bg px-3 py-2 text-[13px] text-final">
      <Lock className="size-[15px] shrink-0" aria-hidden />
      <span>
        {t('text', { date: fmt.date(at), time: formatTime(at, fmt), name: userName ?? t('unknownUser'), channel: tc(channelKey(channel)) })}
      </span>
    </p>
  );
}
