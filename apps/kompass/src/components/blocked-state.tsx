import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

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
      <div className="flex items-center gap-2 text-[12px]">
        <span className="rounded-sm bg-badge px-1.5 py-0.5 font-semibold text-badge-ink">{t('notPossible')}</span>
        <span className="text-muted-ink">{step}</span>
      </div>
      <h3 className="font-heading text-[16px]">{title}</h3>
      <p className="text-[14px] leading-[1.55] text-ink-2">{children}</p>
    </section>
  );
}
