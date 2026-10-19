'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Notice } from '@/components/notice';
import { Section } from '@/components/section';

const POLL_MS = 1000;

export interface RunProgressState {
  done: number;
  total: number;
  /** Nur beim Beitragslauf: erzeugte Mitteilungen nach den Beiträgen. */
  notices?: number;
}

/**
 * Der Lauf (wie Serienlauf 109/110): Die Seite ruft den Continue-Handler nacheinander, bis der Lauf fertig ist, und
 * baut dann den Versand neu auf. Kein Hintergrund im Server: Wer die Seite verlässt, setzt beim nächsten Besuch fort.
 */
export function RunProgress({ url, kind, initial, canContinue }: { url: string; kind: 'fees' | 'letters'; initial: RunProgressState; canContinue: boolean }) {
  const t = useTranslations('members.runs.progress');
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [stalled, setStalled] = useState<string | null>(null);

  useEffect(() => {
    if (!canContinue) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const response = await fetch(url, { method: 'POST' });
        if (cancelled) return;
        if (response.ok) {
          const body = (await response.json()) as RunProgressState & { finished: boolean };
          if (cancelled) return;
          setState(body);
          if (body.finished) {
            router.refresh();
            return;
          }
        } else {
          const body = response.status === 409 ? ((await response.json()) as { code?: string; message?: string }) : null;
          if (cancelled) return;
          if (body?.code === 'feeRunDone' || body?.code === 'dunningRunDone') {
            router.refresh();
            return;
          }
          setStalled(body?.message ?? '');
          return;
        }
      } catch {
        // Netz weg: gleich noch einmal — der Dienst legt nichts doppelt an.
        if (cancelled) return;
      }
      timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [url, canContinue, router]);

  const total = Math.max(state.total, state.done);
  return (
    <section data-testid="run-progress" className="rounded-md border border-line bg-surface p-4">
      <Section title={t('title')}>
        <div className="space-y-3">
          {/* Spur und Füllung in Tokens wie im Serienlauf (14 A3). */}
          <progress
            value={state.done}
            max={Math.max(total, 1)}
            aria-label={t('title')}
            className="h-2 w-full appearance-none overflow-hidden rounded-full bg-surface-2 [&::-moz-progress-bar]:bg-brand [&::-webkit-progress-bar]:bg-surface-2 [&::-webkit-progress-value]:bg-brand"
          />
          <p data-testid="run-progress-status" role="status" aria-live="polite" className="text-meta tabular-nums text-ink">
            {kind === 'fees' ? t('fees', { done: state.done, total }) : t('letters', { done: state.done, total })}
            {kind === 'fees' && state.notices ? ` · ${t('notices', { count: state.notices })}` : ''}
          </p>
          <p className="text-meta text-ink-2">{canContinue ? t('leave') : t('noPermission')}</p>
          {stalled !== null ? (
            <Notice level="warn">
              {stalled ? `${stalled} ` : ''}
              {t('stalled')}
            </Notice>
          ) : null}
        </div>
      </Section>
    </section>
  );
}
