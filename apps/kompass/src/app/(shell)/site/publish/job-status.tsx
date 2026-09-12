'use client';

import type { RunningSiteJob } from '@kompass/module-site';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

const POLL_MS = 1000;

/**
 * Zeigt, was gerade gebaut oder übertragen wird und seit wann. Der Riegel im
 * Modul kennt den Lauf; diese Anzeige fragt ihn über /site/job ab, damit auch
 * ein neu geladener Tab sieht, dass etwas läuft, und die Seite sich danach
 * erneuert. Kein Server-Action-Aufruf: die stünden hinter dem laufenden Bau an.
 */
export function JobStatus({ onFinished }: { onFinished?: () => void }) {
  const t = useTranslations('site.publish.job');
  const [job, setJob] = useState<RunningSiteJob | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    let previous: RunningSiteJob | null = null;
    const tick = async () => {
      const current = await fetch('/site/job', { cache: 'no-store' })
        .then((r) => (r.ok ? (r.json() as Promise<RunningSiteJob | null>) : null))
        .catch(() => null);
      if (!active) return;
      if (previous && !current) onFinished?.();
      previous = current;
      setJob(current);
      setNow(Date.now());
    };
    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
    // onFinished ist eine Aktion, keine Abhängigkeit des Abfragens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!job) return null;
  const seconds = Math.max(0, Math.floor((now - Date.parse(job.startedAt)) / 1000));
  const duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return (
    <p data-testid="site-job" aria-live="polite" className="flex items-center gap-2 rounded-lg border border-line bg-surface px-5 py-3 text-[13px] font-medium text-ink-2">
      <span className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden />
      {t('running', { name: t(`names.${job.name}`), duration })}
    </p>
  );
}
