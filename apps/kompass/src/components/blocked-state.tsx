import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { SectionHeading } from '@/components/section';

/**
 * „Seite erlaubt, dieser Schritt nicht“ (HANDOFF § 2.12) — ruhiger Text auf
 * Fläche, kein rotes 403 (das bleibt `ForbiddenCard` für „Seite gar nicht
 * erlaubt“). Drei Teile: das Kennzeichen „nicht möglich“ mit dem Namen des
 * Schritts, der Titel, ein Satz mit Grund und wer es erledigen kann.
 */
export function BlockedState({ step, title, children }: { step: string; title: string; children: ReactNode }) {
  const t = useTranslations('common.blocked');
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-line bg-surface-2 p-5">
      <div className="flex items-center gap-2 text-hint">
        <span className="rounded-sm bg-badge px-1.5 py-0.5 font-semibold text-badge-ink">{t('notPossible')}</span>
        <span className="text-muted-ink">{step}</span>
      </div>
      <SectionHeading>{title}</SectionHeading>
      <p className="text-body text-ink-2">{children}</p>
    </section>
  );
}
