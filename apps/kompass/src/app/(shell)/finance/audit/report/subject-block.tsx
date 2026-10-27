'use client';

import type { AuditReportView } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useDateFormat } from '@/components/date-format-provider';
import { FixedValue } from '@/components/fixed-value';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { FormGrid } from '@/components/forms/form-grid';
import { KeyLine } from '@/components/key-line';
import { Section } from '@/components/section';
import { formatEuro } from '@/lib/finance/amount';
import { joinNames } from '../audit-header';

/**
 * Block „Gegenstand · von Kompass“ (Board 12d): was Kompass einsetzt, als `FixedValue` mit Link auf die Quelle —
 * Verein, Jahr, Prüffassung, geprüfte Berichte mit Kurz-Hash, Umfang und Kassenbestand mit Zeugen. Beim Nachtrag statt
 * der Berichte die seit der Prüffassung geänderten Buchungen.
 */
/**
 * Lauter feste Werte, kein Feld daneben, mit dem sie fluchten müssten: Wert 4 px unter dem Label wie die Ergebniszeile im
 * Jahresabschluss, ohne die Feldhöhe von `FixedValue` (Designer Runde 5, 272). Nur Layout an der Aufrufstelle.
 */
export const TIGHT = 'gap-1 [&_[data-slot=fixed-value]]:min-h-0';

export function SubjectBlock({ report, organization, yearId, witnessNames }: { report: AuditReportView; organization: string; yearId: string; witnessNames: string[] }) {
  const t = useTranslations('finance.audit.report.subject');
  const tAudit = useTranslations('finance.audit');
  const tReports = useTranslations('finance.reports');
  const fmt = useDateFormat();
  const s = report.subject;
  // Abgelegt: kein gemeinsamer Satz mehr. Die Werte beschreibt dann der Titel des Abschnitts (statt je Wert ein leerer Grund).
  const reason = report.state === 'filed' ? 'report-subject-title' : 'subject-reason';
  const year = encodeURIComponent(yearId);
  const cash = s.cash
    ? witnessNames.length > 0
      ? t('cashWitnesses', { amount: formatEuro(s.cash.countedCents), date: fmt.date(s.cash.countedOn), names: joinNames(witnessNames, tAudit('head.and')) })
      : t('cashValue', { amount: formatEuro(s.cash.countedCents), date: fmt.date(s.cash.countedOn) })
    : null;
  return (
    <FormCard as="section" data-testid="report-subject">
      <FormCardBody>
        {/* Nach der Ablage aktualisiert sich nichts mehr: der Satz fällt weg (272). */}
        <Section title={t('title')} headingId="report-subject-title" intro={report.state === 'filed' ? undefined : <span id="subject-reason">{t('reason')}</span>}>
          <FormGrid>
            <FixedValue id="subject-org" label={t('organization')} value={organization || null} describedBy={reason} size="m" className={TIGHT} />
            <FixedValue id="subject-year" label={t('year')} value={t('yearValue', { from: fmt.date(s.startsOn), to: fmt.date(s.endsOn) })} describedBy={reason} size="m" className={TIGHT} />
            <FixedValue id="subject-baseline" label={t('baseline')} value={t('baselineValue', { date: fmt.date(s.baseline.createdAt) })} describedBy={reason} size="m" className={TIGHT} />
            {report.kind === 'followUp' ? (
              <FixedValue
                id="subject-changed"
                label={t('changed')}
                value={t('changedValue', { count: s.changedEntryIds.length })}
                href={s.changedEntryIds.length > 0 ? `/finance/audit/journal?year=${year}&ids=${s.changedEntryIds.join(',')}` : undefined}
                describedBy={reason}
                size="m"
                className={TIGHT}
              />
            ) : (
              <FixedValue
                id="subject-reports"
                label={t('reports')}
                value={
                  s.reports.length > 0 ? (
                    <span className="flex flex-col gap-0.5">
                      {s.reports.map((r) => (
                        <span key={r.key}>
                          <Link href={`/finance/reports/${r.key}?year=${year}`} className="text-link underline-offset-2 hover:underline">
                            {tReports.has(`${r.key}.title`) ? tReports(`${r.key}.title`) : r.key}
                          </Link>
                          <KeyLine>{r.shortHash}</KeyLine>
                        </span>
                      ))}
                    </span>
                  ) : null
                }
                describedBy={reason}
                size="full"
                className={TIGHT}
              />
            )}
            <FixedValue
              id="subject-scope"
              label={t('scope')}
              value={t('scopeValue', { sampled: s.samples.sampledEntries, total: s.samples.totalEntries, reviewed: s.sectionsReviewed.reviewed, sections: s.sectionsReviewed.total })}
              describedBy={reason}
              size="full"
              className={TIGHT}
            />
            <FixedValue
              id="subject-cash"
              label={t('cash')}
              value={
                cash ? (
                  <span>
                    {cash}{' '}
                    <a href={`/finance/cash/${s.cash!.countId}/protocol`} target="_blank" rel="noopener" className="text-link underline-offset-2 hover:underline">
                      {t('protocol')}
                    </a>
                  </span>
                ) : null
              }
              describedBy={reason}
              size="full"
              className={TIGHT}
            />
          </FormGrid>
        </Section>
      </FormCardBody>
    </FormCard>
  );
}
