import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { StatusBadge } from '@/components/status-badge';
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
export function EntryStateBadge({ entry }: { entry: EntryStateBadgeEntry }) {
  const t = useTranslations('finance.state');
  const ta = useTranslations('finance.agent');

  const word =
    entry.status === 'draft' && !entry.reviewedAt ? (
      <StatusBadge tone="warning" dot>{t('draft')}</StatusBadge>
    ) : entry.status === 'draft' && entry.reviewedAt ? (
      <StatusBadge tone="info" dot>{t('reviewed')}</StatusBadge>
    ) : entry.status === 'final' && entry.reversedByEntryId ? (
      <StatusBadge tone="neutral">{t('reversed')}</StatusBadge>
    ) : (
      <StatusBadge tone="final">
        <Lock className="size-3" aria-hidden />
        {t('final')}
      </StatusBadge>
    );

  return (
    <span className="inline-flex items-center gap-1.5">
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
