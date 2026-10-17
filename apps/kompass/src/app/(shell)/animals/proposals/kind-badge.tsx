'use client';

import type { ProposalKind } from '@kompass/module-animals';
import { FilePlus2, Link2, MessageSquareText, PencilLine, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

const ICONS: Record<ProposalKind, LucideIcon> = { create: FilePlus2, update: PencilLine, notice: MessageSquareText, sameAs: Link2 };

/**
 * Art eines Vorschlags: Symbol und Wort als Text (Runde 3, 049). Die Art ist eine Einordnung, keine Abweichung — sie
 * trägt keine Marke; das Violett der Maschinen-Herkunft bleibt dem Reiter „Vorschläge“ und der Marke am Hund.
 */
export function KindBadge({ kind }: { kind: ProposalKind }) {
  const t = useTranslations('animals.proposals.kinds');
  const Icon = ICONS[kind];
  return (
    <span data-testid="proposal-kind" className="inline-flex items-center gap-1.5 text-ink-2">
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {t(kind)}
    </span>
  );
}
