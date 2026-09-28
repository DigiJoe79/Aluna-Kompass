'use client';

import { useTranslations } from 'next-intl';
import type { SaveState } from '@/lib/autosave';
import { cn } from '@/lib/utils';

export type { SaveState } from '@/lib/autosave';

/** Uhrzeit in der Zeitzone des Vereins — dieselbe auf Server und Client, sonst zeichnet die Hydration um. */
const clock = (iso: string) => new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }).format(new Date(iso));

/**
 * Die Speicherzeile einer laufend gesicherten Maske (Verhalten D1):
 * „Zwischenstand gespeichert · 21:14“, „Wird gespeichert …“ oder, ohne Netz,
 * der Satz, dass die Eingaben auf dem Gerät bleiben. `aria-live="polite"`,
 * damit ein Vorleser den Stand mitbekommt, ohne unterbrochen zu werden.
 * `data-pending` sagt, ob noch etwas Getipptes auf die nächste Sicherung wartet.
 */
export function SaveStatus({ state, pending }: { state: SaveState; pending: boolean }) {
  const t = useTranslations('common.autosave');
  const text =
    state.kind === 'saving' ? t('saving') : state.kind === 'saved' ? t('saved', { time: clock(state.at) }) : state.kind === 'offline' ? t('offline') : state.kind === 'failed' ? t('failed', { detail: state.detail }) : t('idle');
  return (
    <p data-testid="save-status" data-pending={pending} role="status" aria-live="polite" className={cn('text-[12px] leading-snug', state.kind === 'offline' || state.kind === 'failed' ? 'text-warning' : 'text-muted-ink')}>
      {text}
    </p>
  );
}
