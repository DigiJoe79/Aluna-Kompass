'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { MouseEvent } from 'react';
import { useSyncExternalStore } from 'react';
import { buttonVariants } from '@/components/ui/button';

export type BackMode = 'origin' | 'parent';

const browserNavigation = () => (typeof navigation === 'undefined' ? null : navigation);

const subscribe = (onChange: () => void) => {
  const target = browserNavigation();
  target?.addEventListener('currententrychange', onChange);
  return () => target?.removeEventListener('currententrychange', onChange);
};
const canGoBack = () => browserNavigation()?.canGoBack ?? false;

/** Steht die Elternseite im Verlauf direkt davor? */
function parentIsPrevious(href: string) {
  const target = browserNavigation();
  const index = target?.currentEntry?.index ?? 0;
  const previous = index > 0 ? target?.entries()[index - 1]?.url : undefined;
  return previous ? new URL(previous).pathname === href : false;
}

/**
 * Der Pfeil einer Seite, die man von überall erreicht (Spec Rückweg aus der Akte).
 *
 * `origin` (Dokument): Mit einer Vorseite im Tab macht er dasselbe wie die Zurück-Taste, so bleiben Filter und Stelle
 * der Ausgangsseite. Ohne Vorseite steht die Elternseite.
 *
 * `parent` (Editor): Er führt immer zur Elternseite, denn nach dem Anlegen ist er der Weg zum fertigen Dokument. Steht sie
 * im Verlauf direkt davor, geht er zurück, sonst ersetzt er den Eintrag. Sonst läge der Editor hinter dem Dokument, und
 * dessen Pfeil führte in ihn zurück.
 *
 * Er bleibt ein echter Link: Mit Taste oder Mittelklick öffnet er die Elternseite, und die Rückfrage bei ungespeicherten
 * Änderungen (`leavingLink`) fängt ihn wie jeden anderen ab.
 */
export function BackLink({ href, label, mode }: { href: string; label: string; mode: BackMode }) {
  const t = useTranslations('common');
  const router = useRouter();
  const hasPrevious = useSyncExternalStore(subscribe, canGoBack, () => false);
  const goBack = (event: MouseEvent) => {
    if (!browserNavigation() || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (mode === 'origin' && !hasPrevious) return;
    event.preventDefault();
    if (mode === 'origin' || parentIsPrevious(href)) router.back();
    else router.replace(href);
  };
  return (
    <Link href={href} onClick={goBack} className={`${buttonVariants({ variant: 'ghost', size: 'sm' })} -ml-2 mb-1`}>
      <span aria-hidden>←</span>
      {mode === 'origin' && hasPrevious ? t('back') : label}
    </Link>
  );
}
