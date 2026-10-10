'use client';

import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { toastRefusal } from '@/lib/feedback';
import { Switch } from '@/components/ui/switch';
import type { ActionState } from '@/lib/actions';
import { useSiteJobStatus } from '@/components/site/site-job-provider';

/**
 * R5 (MUSTER: Ausnahme): Der Schalter sitzt in einer Tabellenzeile, über ihm ist kein Platz für eine Meldung —
 * eine Ablehnung bleibt als Toast stehen (`toastRefusal`), bis man sie schließt.
 *
 * `switchAfterText`: für rechtsbündige Spalten. Die beiden Beschriftungen sind verschieden lang; steht der
 * Schalter vorn, springt er je nach Zustand hin und her, hinten sitzen alle bündig am Rand (Befund Joe,
 * 2026-09-30, ohne Layout-Test).
 */
export function PublishSwitch({ id, isPublished, action, label, switchAfterText = false }: { id: string; isPublished: boolean; action: (id: string, next: boolean) => Promise<ActionState>; label?: string; switchAfterText?: boolean }) {
  const t = useTranslations('content');
  const [pending, start] = useTransition();
  // Die Kopfzeile zählt „nicht publiziert“ gleich mit (Plan C).
  const { refresh } = useSiteJobStatus();
  return (
    <label className={`flex items-center gap-2 text-[13px] ${switchAfterText ? 'flex-row-reverse' : ''}`}>
      <Switch checked={isPublished} disabled={pending} aria-label={label ?? t('published')} onCheckedChange={(next) => start(async () => { const s = await action(id, next); toastRefusal(s); if (s.status === 'success') refresh(); })} />
      <span className={isPublished ? 'text-success' : 'text-muted-ink'}>{isPublished ? t('published') : t('unpublished')}</span>
    </label>
  );
}
