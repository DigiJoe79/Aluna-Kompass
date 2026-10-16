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
 * Ohne sichtbaren Text: Der Schalter sagt den Zustand selbst, das `aria-label` bleibt (Designer Stufe 2 Nr. 6d).
 */
export function PublishSwitch({ id, isPublished, action, label }: { id: string; isPublished: boolean; action: (id: string, next: boolean) => Promise<ActionState>; label?: string }) {
  const t = useTranslations('content');
  const [pending, start] = useTransition();
  // Die Kopfzeile zählt „nicht publiziert“ gleich mit (Plan C).
  const { refresh } = useSiteJobStatus();
  return (
    <Switch checked={isPublished} disabled={pending} aria-label={label ?? t('published')} onCheckedChange={(next) => start(async () => { const s = await action(id, next); toastRefusal(s); if (s.status === 'success') refresh(); })} />
  );
}
