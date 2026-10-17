import { useTranslations } from 'next-intl';
import { Overline } from '@/components/overline';

export interface ConsequenceListItem {
  /** Der Satz mit der Zahl aus den Daten (etwa `previewDiscardRun`) — nie geschätzt oder gerundet. */
  label: string;
  /** Die Zahl im Satz; eine Folge mit 0 fällt weg (Designer Runde 3, 079: keine Nullzeilen). */
  count?: number;
}

/**
 * „Was jetzt passiert“ (HANDOFF § 12.1, Baustein `ConsequenceList`): die Folgen
 * als Sätze mit Zahlen aus den Daten, darunter — wenn vorhanden — „Was bleibt“.
 * Die Zahl steht nur im Satz, nicht noch einmal groß davor (07-1 B28 · 09 B15).
 * Generisch: trägt A4 (Zurücknehmen), B2 (Auszug verwerfen) und später G1
 * (Jahr wieder öffnen).
 */
export function ConsequenceList({ items, stays }: { items: ConsequenceListItem[]; stays?: string[] }) {
  const t = useTranslations('common.consequenceList');
  return (
    <div className="space-y-3">
      <ul className="list-disc space-y-1.5 pl-5 text-meta text-ink-2">
        {items.filter((item) => item.count !== 0).map((item, index) => (
          <li key={index}>{item.label}</li>
        ))}
      </ul>
      {/* „Was bleibt“ wie die Folgen als Aufzählung, ohne Kasten, mit Feldbezeichnung statt Kapitälchen — ein Muster für
          die Folgen einer Handlung (Runde 3, 108; wie 079). Layout ohne dauerhaften Test. */}
      {stays && stays.length > 0 ? (
        <div>
          <Overline field>{t('stays')}</Overline>
          <ul className="mt-1 list-disc space-y-1.5 pl-5 text-meta text-ink-2">
            {stays.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
