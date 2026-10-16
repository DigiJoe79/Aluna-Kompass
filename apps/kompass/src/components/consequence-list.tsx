import { useTranslations } from 'next-intl';
import { Overline } from '@/components/overline';

export interface ConsequenceListItem {
  /** Die Zahl aus den Daten (etwa `previewDiscardRun`) — nie geschätzt oder gerundet. */
  number: number;
  label: string;
}

/**
 * „Was jetzt passiert“ (HANDOFF § 12.1, Baustein `ConsequenceList`): nummerierte
 * Folgen mit Zahlen aus den Daten, darunter — wenn vorhanden — „Was bleibt“.
 * Generisch: trägt A4 (Zurücknehmen), B2 (Auszug verwerfen) und später G1
 * (Jahr wieder öffnen).
 */
export function ConsequenceList({ items, stays }: { items: ConsequenceListItem[]; stays?: string[] }) {
  const t = useTranslations('common.consequenceList');
  return (
    <div className="space-y-3">
      <ol className="space-y-1.5">
        {items.map((item, index) => (
          <li key={index} className="flex items-baseline gap-2.5 text-meta">
            <span className="w-6 shrink-0 text-right font-semibold tabular-nums text-ink">{item.number}</span>
            <span className="text-ink-2">{item.label}</span>
          </li>
        ))}
      </ol>
      {stays && stays.length > 0 ? (
        <div className="rounded-md border border-line bg-surface-2 p-2.5">
          <Overline>{t('stays')}</Overline>
          <ul className="mt-1 space-y-1 text-meta text-ink-2">
            {stays.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
