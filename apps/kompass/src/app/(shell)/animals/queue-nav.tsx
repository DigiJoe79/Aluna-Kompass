'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import type { AnimalQueue } from './list-params';

/**
 * „3 von 17“ mit Pfeilen: Die Maske blättert durch die Liste, aus der man kam.
 * Stand der Hund schon beim Öffnen nicht in der Auswahl, zeichnet sie nichts; der
 * Rückweg zur Liste steht ohnehin über dem Titel. Fällt er erst in der Maske aus
 * dem Filter, bleibt der Platz vom Öffnen stehen (`key` je Hund an der Seite).
 */
/** `basePath`: Prüfseiten der Vorschläge blättern unter `/animals/proposals`; `keepTab`: dort gibt es keinen Reiter. */
export function QueueNav({ queue, basePath = '/animals', keepTab = true }: { queue: AnimalQueue; basePath?: string; keepTab?: boolean }) {
  const t = useTranslations('animals.queue');
  // Der Reiter wird beim Wechsel nur in der Adresse nachgezogen; von dort liest ihn der Pfeil.
  const tab = useSearchParams().get('tab');
  const [openedAt] = useState(queue.position);
  const position = queue.position ?? openedAt;
  const { query } = queue;
  if (!position) return null;
  const href = (id: string) => `${basePath}/${id}${query ? `?${query}` : ''}${keepTab && tab ? `${query ? '&' : '?'}tab=${encodeURIComponent(tab)}` : ''}`;
  const arrow = (id: string | null, label: string, Icon: typeof ChevronLeft) =>
    id ? (
      <Link href={href(id)} aria-label={label} title={label} className={buttonVariants({ variant: 'ghost', size: 'icon' })}>
        <Icon aria-hidden />
      </Link>
    ) : (
      <Button type="button" variant="ghost" size="icon" disabled aria-label={label}>
        <Icon aria-hidden />
      </Button>
    );
  return (
    <nav aria-label={t('label')} className="flex items-center gap-1">
      {arrow(position.previousId, t('previous'), ChevronLeft)}
      <span className="px-1 text-meta text-ink-2">{t('position', { index: position.index, total: position.total })}</span>
      {arrow(position.nextId, t('next'), ChevronRight)}
    </nav>
  );
}
