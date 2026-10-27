'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { AuditPackageView } from '@/lib/finance/audit-package-view';
import { PackageRunCard } from '../../audit/package-run-card';
import type { ClosingStepBody } from '../step-body';

/**
 * Schritt 9 (14d A): wer prüft (Satz mit Link „Prüfer eintragen“), wem der Zugang fehlt, und der Lauf „Prüffassungen
 * und Prüfpaket erzeugen“ aus D1b ohne innere Karte, „Prüfpaket erzeugen“ primär — erst im abgeschlossenen Jahr.
 */
export function AuditPackageStep({ step, status, packageRun }: ClosingStepBody<'auditPackage'> & { packageRun: AuditPackageView | null }) {
  const t = useTranslations('finance.closing.auditPackage');
  const f = step.facts;
  const audit = `/finance/audit?year=${encodeURIComponent(status.fiscalYearId)}`;
  const missing = f.auditors.filter((a) => !a.accessOk).map((a) => a.name);
  const link = 'text-link underline-offset-2 hover:underline';
  return (
    <div className="flex flex-col gap-2.5" data-testid="closing-body-auditPackage">
      {f.auditors.length === 0 ? (
        <p className="text-meta text-ink-2">
          {t('noAuditors')}{' '}
          <Link href={audit} className={link}>
            {t('addAuditors')}
          </Link>
        </p>
      ) : (
        <p className="text-meta text-ink-2" data-testid="closing-auditors">
          {t('auditors', { names: f.auditors.map((a) => (a.mode === 'paper' ? t('onPaper', { name: a.name }) : t('inKompass', { name: a.name }))).join(', ') })}
        </p>
      )}
      {missing.length > 0 ? (
        <p className="text-meta text-ink-2" data-testid="closing-access-missing">
          {t('noAccess', { list: missing.join(', ') })}{' '}
          <Link href={audit} className={link}>
            {t('toAudit')}
          </Link>
        </p>
      ) : null}
      {status.yearStatus !== 'closed' ? <p className="text-meta text-muted-ink">{t('yearOpen')}</p> : packageRun ? <PackageRunCard yearId={status.fiscalYearId} initial={packageRun} variant="step" /> : null}
    </div>
  );
}
