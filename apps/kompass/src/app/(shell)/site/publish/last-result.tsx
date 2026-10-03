'use client';

import type { SiteJobKind } from '@kompass/module-site';
import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { useSiteJobStatus } from '@/components/site/site-job-provider';
import { Button } from '@/components/ui/button';
import type { ActionState } from '@/lib/actions';
import type { DetailView } from '@/lib/site-job-view';

/**
 * Das letzte Ergebnis einer Art mit Listen und Protokollende, vom Server —
 * auch nach dem Neuladen und auch, wenn der Lauf über MCP gestartet
 * wurde. Neu geladen wird, sobald der Poller ein anderes Ergebnis dieser Art
 * meldet; `superseded` kommt immer frisch aus dem Poller, weil es sich ändert,
 * ohne dass ein neuer Lauf entsteht (ein Publish überholt die Vorschau).
 */
export function useSiteJobDetail(kind: SiteJobKind): DetailView | null {
  const { last } = useSiteJobStatus();
  const summary = last?.[kind] ?? null;
  const runId = summary?.runId ?? null;
  const [detail, setDetail] = useState<DetailView | null>(null);
  useEffect(() => {
    if (!runId) {
      setDetail(null);
      return;
    }
    let active = true;
    fetch(`/site/job/${kind}`, { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<{ last: DetailView | null }>) : null))
      .then((body) => active && body?.last && setDetail(body.last))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [kind, runId]);
  if (!detail || !summary || detail.runId !== summary.runId) return null;
  return { ...detail, superseded: summary.superseded };
}

/** Startet einen Lauf über eine Action und meldet ihn beim Poller an; ein Fehler kommt als Toast oder an `onError`. */
export function useStartJob() {
  const { track } = useSiteJobStatus();
  const [pending, startTransition] = useTransition();
  const start = (action: () => Promise<ActionState>, hooks: { onError?: (state: Extract<ActionState, { status: 'error' }>) => void; onStarted?: (runId: string) => void } = {}) =>
    startTransition(async () => {
      const state = await action();
      if (state.status === 'error') {
        if (hooks.onError) hooks.onError(state);
        else toast.error(state.message);
      } else if (state.status === 'success') {
        const { runId } = state.data as { runId: string };
        hooks.onStarted?.(runId);
        track(runId);
      }
    });
  return { pending, start };
}

/**
 * Ein Lauf, der nicht zu Ende kam (fehlgeschlagen, abgebrochen, unterbrochen):
 * der Grund, wo er stand, und ein Knopf, ihn erneut zu starten — der fertige
 * Teil liegt im Cache. Ein Erfolg zeigt hier nichts; ihn zeigt die Karte.
 */
export function LastResult({ kind, onRestart, restartDisabled }: { kind: SiteJobKind; onRestart?: () => void; restartDisabled?: boolean }) {
  const t = useTranslations('site.publish');
  const { last } = useSiteJobStatus();
  const summary = last?.[kind] ?? null;
  if (!summary || summary.status === 'success') return null;
  const reason = summary.status === 'interrupted' ? t('run.reason.interrupted') : summary.reason ? t(`run.reason.${summary.reason}`) : (summary.error?.message ?? '');
  return (
    <section aria-label={t('run.lastTitle', { kind: t(`job.names.${kind}`) })} className="flex flex-col gap-2 rounded-md border border-line bg-surface-2 p-3 text-[13px]">
      <p className="flex items-start gap-2 font-semibold text-error">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        {t(`run.status.${summary.status}`)}
      </p>
      {reason ? <p className="text-ink-2">{reason}</p> : null}
      {summary.lastStep ? <p className="text-muted-ink">{t('run.lastStep', { step: t(`job.steps.${summary.lastStep}`) })}</p> : null}
      {onRestart ? (
        <div>
          <Button variant="outline" size="sm" disabled={restartDisabled} onClick={onRestart}>
            {t('run.restart')}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
