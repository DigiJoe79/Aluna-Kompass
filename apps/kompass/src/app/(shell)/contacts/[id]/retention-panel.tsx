'use client';

import { useDateFormat } from '@/components/date-format-provider';
import { useTranslations } from 'next-intl';
import { roleLabel } from '@/lib/contact-roles';
import { Section } from '@/components/section';
import { Disclosure } from '@/components/ui/disclosure';

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
  const reason = (h: (typeof holds)[number]) =>
    h.entity === 'contactRole' && roleKeysById[h.id] ? t('retention.roleHold', { role: roleLabel(t, roleKeysById[h.id]!) }) : h.label;
  // Kernaussage zuerst (04 B10): Was den Kontakt am längsten hält — ein dauerhafter Halter vor jeder Frist.
  const decisive = holds.find((h) => h.until === null) ?? [...holds].sort((a, b) => (a.until! < b.until! ? 1 : -1))[0];
  const line = (h: (typeof holds)[number]) => (h.until ? t('retention.heldUntil', { date: fmt.date(h.until) }) : t('retention.heldPermanently'));

  return (
    <section className="rounded-md border border-line bg-surface p-5">
      <Section title={t('retention.title')}>
        {decisive ? (
          <div className="flex flex-col gap-3">
            <p data-testid="retention-summary" className="text-body text-ink">
              {decisive.until
                ? t('retention.summaryUntil', { date: fmt.date(decisive.until), reason: reason(decisive) })
                : t('retention.summaryPermanent', { reason: reason(decisive) })}
            </p>
            {holds.length > 1 ? (
              <Disclosure label={t('retention.details')} count={holds.length} bounded={false}>
                <ul data-testid="retention-holds" className="space-y-1.5 text-meta text-ink-2">
                  {holds.map((h) => (
                    <li key={`${h.entity}:${h.id}`}>
                      {reason(h)} — {line(h)}
                    </li>
                  ))}
                </ul>
              </Disclosure>
            ) : null}
          </div>
        ) : (
          <p className="text-meta text-muted-ink">{t('retention.unknown')}</p>
        )}
      </Section>
    </section>
  );
}
