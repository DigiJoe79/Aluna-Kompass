'use client';

import { useTranslations } from 'next-intl';
import { Section } from '@/components/section';
import type { TargetAudit } from '@/lib/finance/entry-audit';
import { AuditRemarks } from './audit-remarks';
import { RemarkWriter } from './remark-writer';

/**
 * Abschnitt „Vermerke“ am Gegenstand (Board 4c, 9b; N3): an der Buchung direkt nach den Daten, vor „Verlauf“, am
 * Bericht unter den Fassungen; nur, wenn es einen gibt oder ein Prüfer schreiben darf. Kein Seitenfenster — der
 * Vermerk gehört zum Gegenstand. `withWriter`: „Vermerk schreiben …“ im Abschnitt (am Bericht steht er im Kopf).
 */
export function RemarksCard({ audit, withWriter = true, framed = true }: { audit: TargetAudit; withWriter?: boolean; /** Am Bericht ohne Karte: Titel auf dem Seitengrund wie „Festgeschriebene Fassungen“ (279). */ framed?: boolean }) {
  const t = useTranslations('finance.audit.remarks');
  if (audit.items.length === 0 && !audit.writer) return null;
  const section = (
    <Section title={t('title')} actions={withWriter && audit.writer ? <RemarkWriter {...audit.writer} /> : null}>
      {audit.items.length > 0 ? <AuditRemarks items={audit.items} canAnswer={audit.canAnswer} canAudit={audit.canAudit} /> : <p className="text-meta text-muted-ink">{t('empty')}</p>}
    </Section>
  );
  if (!framed) return <div data-testid="audit-remarks-card">{section}</div>;
  return (
    <section className="rounded-md border border-line bg-surface p-4" data-testid="audit-remarks-card">
      {section}
    </section>
  );
}
