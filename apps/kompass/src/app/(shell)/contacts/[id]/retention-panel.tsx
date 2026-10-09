'use client';

import { useDateFormat } from '@/components/date-format-provider';
import { useTranslations } from 'next-intl';
import { roleLabel } from '@/lib/contact-roles';

/** Was den Kontakt hält und bis wann. Löschen steht im Seitenkopf unter „Weitere Aktionen“ (`contact-actions.tsx`). */
export function RetentionPanel({
  holds,
  roleKeysById,
}: {
  holds: { entity: string; id: string; label: string; until: string | null }[];
  /** Rollenschlüssel je Rollenzeile — der Halter aus dem Modul nennt nur die ID. */
  roleKeysById: Record<string, string>;
}) {
  const t = useTranslations('contacts');
  const fmt = useDateFormat();

  return (
    <section className="rounded-md border border-line bg-surface p-5">
      <h2 className="mb-3 text-[15px] font-semibold text-ink">{t('retention.title')}</h2>

      {holds.length > 0 ? (
        <div data-testid="retention-holds" className="space-y-1.5 text-[13px] text-ink-2">
          {holds.map((h) => (
            <div key={`${h.entity}:${h.id}`} className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-muted-ink" aria-hidden />
              <span>
                {h.entity === 'contactRole' && roleKeysById[h.id]
                  ? t('retention.roleHold', { role: roleLabel(t, roleKeysById[h.id]!) })
                  : h.label}
                {' — '}
                {h.until ? t('retention.heldUntil', { date: fmt.date(h.until) }) : t('retention.heldPermanently')}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[13px] text-muted-ink">{t('retention.unknown')}</p>
      )}
    </section>
  );
}
