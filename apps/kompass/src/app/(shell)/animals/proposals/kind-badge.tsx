'use client';

import type { ProposalKind } from '@kompass/module-animals';
import { FilePlus2, Link2, MessageSquareText, PencilLine, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { StatusBadge } from '@/components/status-badge';

const ICONS: Record<ProposalKind, LucideIcon> = { create: FilePlus2, update: PencilLine, notice: MessageSquareText, sameAs: Link2 };

/** Art eines Vorschlags: Symbol und Wort im Violett der Maschinen-Herkunft (Board Vorschläge 1a). */
export function KindBadge({ kind }: { kind: ProposalKind }) {
  const t = useTranslations('animals.proposals.kinds');
  return (
    <StatusBadge tone="agent" icon={ICONS[kind]} testId="proposal-kind">
      {t(kind)}
    </StatusBadge>
  );
}
