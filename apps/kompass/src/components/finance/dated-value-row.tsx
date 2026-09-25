'use client';

import { useDateFormat } from '@/components/date-format-provider';
import { StatusBadge } from '@/components/status-badge';

export interface DatedValueRowEntry {
  validFrom: string;
  display: string;
  source: 'shipped' | 'override';
}

/**
 * H6 — eine Zeile je Stichtag: Stichtag und Wert in Mono, Herkunft als Badge
 * (ausgeliefert mit Quelle · vom Verein überschrieben mit „zurücknehmen“).
 */
export function DatedValueRow({ entry, shippedLabel, overrideLabel, revertLabel, onRevert, pending }: {
  entry: DatedValueRowEntry;
  shippedLabel: string;
  overrideLabel: string;
  revertLabel: string;
  onRevert?: () => void;
  pending?: boolean;
}) {
  const { date } = useDateFormat();
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line-2 px-3 py-2 text-[13px] last:border-b-0" data-testid="dated-value-row">
      <span className="font-mono text-ink-2">{date(entry.validFrom)}</span>
      <span className="flex-1 text-right font-mono font-semibold text-ink">{entry.display}</span>
      <StatusBadge tone={entry.source === 'override' ? 'brand' : 'neutral'}>{entry.source === 'override' ? overrideLabel : shippedLabel}</StatusBadge>
      {entry.source === 'override' && onRevert ? (
        <button type="button" onClick={onRevert} disabled={pending} className="text-[12px] font-semibold text-brand underline">
          {revertLabel}
        </button>
      ) : (
        <span className="w-[64px]" />
      )}
    </div>
  );
}
