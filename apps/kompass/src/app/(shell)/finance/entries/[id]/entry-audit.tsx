'use client';

import { useTranslations } from 'next-intl';
import { SampleCheckbox } from '@/app/(shell)/finance/audit/[section]/sample-checkbox';
import { StatusBadge, statusTone } from '@/components/status-badge';
import { Label } from '@/components/ui/label';
import type { EntryAudit } from '@/lib/finance/entry-audit';

/** Zeile „Als Stichprobe geprüft“ in der Lesesicht der Buchung, nur für Prüfer (Board 4c, N4). */
export function EntrySampleLine({ audit, entryId }: { audit: EntryAudit; entryId: string }) {
  const t = useTranslations('finance.audit');
  if (!audit.sample) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line-2 pt-2" data-testid="entry-sample">
      <span className="flex items-center gap-2">
        <SampleCheckbox key={`${audit.sample.state}`} id="entry-sample-box" fiscalYearId={audit.fiscalYearId} entryId={entryId} checked={audit.sample.checked} label={t('remarks.sample')} fixed={audit.sample.fixed} />
        <Label htmlFor="entry-sample-box" className="font-normal">{t('remarks.sample')}</Label>
      </span>
      {audit.sample.state === 'recheck' ? (
        <StatusBadge tone={statusTone('sample', 'recheck')} dot>
          {t('section.recheck')}
        </StatusBadge>
      ) : null}
      <span className="text-hint text-muted-ink">{t('remarks.sampleHint')}</span>
    </div>
  );
}
