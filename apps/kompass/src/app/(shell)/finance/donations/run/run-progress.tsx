'use client';

import type { RunCounts } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Notice } from '@/components/notice';
import { runProgress } from '@/lib/finance/run';

const POLL_MS = 1000;

/**
 * Der Lauf (README 3i): Fortschritt mit Zahl (`aria-live`) und der einzige
 * Fortschrittsbalken außerhalb von Ziel/Schwelle — er zeigt Arbeit, keine
 * Kennzahl. Die Seite ruft den Continue-Handler (POST, je Aufruf fünf
 * Bestätigungen) nacheinander, bis der Lauf fertig ist, und baut dann das
 * Ergebnis neu auf. Kein Hintergrund im Server: Wer die Seite verlässt, setzt
 * beim nächsten Besuch fort, weil die Seite den Stand aus `getConfirmationRun`
 * liest. Ohne `finance.donationsIssue` wird nur angezeigt, nicht fortgesetzt.
 */
export function RunProgress({ runId, counts: initial, canContinue }: { runId: string; counts: RunCounts; canContinue: boolean }) {
  const t = useTranslations('finance.donations.run.progress');
  const router = useRouter();
  const [counts, setCounts] = useState(initial);
  const [stalled, setStalled] = useState<string | null>(null);

  useEffect(() => {
    if (!canContinue) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const response = await fetch(`/finance/donations/run/${runId}/continue`, { method: 'POST' });
        if (cancelled) return;
        if (response.ok) {
          const body = (await response.json()) as { counts: RunCounts; finishedAt: string | null };
          if (cancelled) return;
          setCounts(body.counts);
          if (body.finishedAt) {
            router.refresh();
            return;
          }
        } else {
          const body = response.status === 409 ? ((await response.json()) as { code?: string; message?: string }) : null;
          if (cancelled) return;
          if (body?.code === 'runAlreadyFinished') {
            router.refresh();
            return;
          }
          setStalled(body?.message ?? '');
          return;
        }
      } catch {
        // Netz weg: gleich noch einmal — der Dienst stellt nichts doppelt aus.
        if (cancelled) return;
      }
      timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId, canContinue, router]);

  const { done, total } = runProgress(counts);
  return (
    <section data-testid="run-progress" className="space-y-3 rounded-md border border-line bg-surface p-4">
      <h3 className="text-[15px] font-semibold text-ink">{t('title')}</h3>
      <progress value={done} max={total} aria-label={t('title')} className="h-2 w-full" />
      <p data-testid="run-progress-status" role="status" aria-live="polite" className="font-mono text-[13px] tabular-nums text-ink">
        {t('status', { done, total })}
      </p>
      <p className="text-[13px] text-ink-2">{canContinue ? t('leave') : t('noPermission')}</p>
      {stalled !== null ? (
        <Notice level="warn">
          {stalled ? `${stalled} ` : ''}
          {t('stalled')}
        </Notice>
      ) : null}
    </section>
  );
}
