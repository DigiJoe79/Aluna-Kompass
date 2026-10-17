import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { isNormalInList, StatusBadge, statusTone } from '@/components/status-badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export interface EntryStateBadgeEntry {
  status: 'draft' | 'final';
  reviewedAt: string | null;
  reversedByEntryId: string | null;
  createdChannel: string;
}

/**
 * Das Wort für den Zustand einer Buchung, aus den Spalten abgeleitet
 * (HANDOFF § 2, Wörterbuch: Entwurf · geprüft · festgeschrieben ·
 * zurückgenommen). Zusätzlich, wenn ein Agent die Buchung vorbereitet hat,
 * ein zweites Kennzeichen mit Tooltip.
 */
export function entryState(entry: EntryStateBadgeEntry): 'draft' | 'reviewed' | 'reversed' | 'final' {
  if (entry.status === 'draft') return entry.reviewedAt ? 'reviewed' : 'draft';
  return entry.reversedByEntryId ? 'reversed' : 'final';
}

/**
 * `inList`: In Listen trägt der Normalzustand „festgeschrieben“ keine Marke (Designer Stufe 2 Nr. 6a); im Seitenkopf
 * steht er immer. Das Kennzeichen „von Agent vorbereitet“ bleibt in beiden.
 */
export function EntryStateBadge({ entry, inList = false }: { entry: EntryStateBadgeEntry; inList?: boolean }) {
  const t = useTranslations('finance.state');
  const ta = useTranslations('finance.agent');
  const state = entryState(entry);

  const word =
    inList && isNormalInList('entry', state) ? null : state === 'final' ? (
      <StatusBadge tone={statusTone('entry', 'final')}>
        <Lock className="size-3" aria-hidden />
        {t('final')}
      </StatusBadge>
    ) : (
      <StatusBadge tone={statusTone('entry', state)} dot={state !== 'reversed' || undefined}>
        {t(state)}
      </StatusBadge>
    );

  // Zwei Marken brechen gemeinsam um, jede bleibt ganz: Nebeneinander machten sie die Statusspalte des Journals so
  // breit, dass die Tabelle rechts hinauslief (Runde 4, 086). Ohne Layout-Test (Einzelstelle).
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {word}
      {entry.createdChannel === 'mcp' ? (
        <Tooltip>
          <TooltipTrigger>
            <StatusBadge tone="agent">{t('agentPrepared')}</StatusBadge>
          </TooltipTrigger>
          <TooltipContent>{ta('tooltip')}</TooltipContent>
        </Tooltip>
      ) : null}
    </span>
  );
}
