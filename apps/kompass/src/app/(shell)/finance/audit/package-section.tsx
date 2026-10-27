'use client';

import { useTranslations } from 'next-intl';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { Section } from '@/components/section';
import type { SectionSummary } from '@/lib/finance/audit-package';
import { PackageTable } from './package-table';

/**
 * Abschnitt „Prüfpaket“ der Übersicht (Board 4a, 4e): in der Prüferansicht mit drei Sätzen Einleitung, für die
 * Schatzmeisterin ohne. Vor dem Abschluss des Jahres nur der Satz, dass es das Paket danach gibt.
 */
export function PackageSection({ yearId, sections, auditorView, auditDone = false, treasurerName = null }: { yearId: string; sections: readonly SectionSummary[]; auditorView: boolean; auditDone?: boolean; /** Wer antwortet (Kontaktrolle Schatzmeister): der Name statt der Rolle (Designer Runde 8, 282). */ treasurerName?: string | null }) {
  const t = useTranslations('finance.audit.package');
  return (
    <FormCard as="section">
      <FormCardBody>
        <Section title={t('title')} intro={auditorView ? t('intro', { treasurer: treasurerName ?? 'none' }) : undefined}>
          {sections.length > 0 ? <PackageTable yearId={yearId} sections={sections} auditorView={auditorView} auditDone={auditDone} /> : <p className="text-meta text-muted-ink">{t('notReady')}</p>}
        </Section>
      </FormCardBody>
    </FormCard>
  );
}
