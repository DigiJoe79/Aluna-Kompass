'use client';

import { Brush, Sparkle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { AiKind } from '@kompass/core';
import { StatusBadge } from '@/components/status-badge';

/**
 * Die Bildkennzeichnung eines Mediums als Marke (Spec KI-Transparenz 2026-10-20, MUSTER § F): `neutral`, Symbol für die
 * Art und Wort — Pinsel für bearbeitet (Designer 2e, wie auf der Webseite), Funkeln für erstellt. „Keine“ ist der Normalzustand und
 * trägt keine Marke.
 */
export function AiKindBadge({ kind, className }: { kind: AiKind | undefined | null; className?: string }) {
  const t = useTranslations('media.aiKind');
  if (!kind || kind === 'none') return null;
  return (
    <StatusBadge tone="neutral" icon={kind === 'edited' ? Brush : Sparkle} testId="ai-kind-badge" className={className}>
      {kind === 'edited' ? t('badgeEdited') : t('badgeGenerated')}
    </StatusBadge>
  );
}
