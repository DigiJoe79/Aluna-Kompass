'use client';

import { useTranslations } from 'next-intl';
import { useDateFormat } from '@/components/date-format-provider';
import { KeyLine } from '@/components/key-line';
import { Section } from '@/components/section';
import { MutedMark, RowLink, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export interface VersionRow {
  reportId: string;
  finalizedAt: string;
  byName: string;
  shortHash: string;
  documentNumber: string;
  voidedAt: string | null;
  voidReason: string | null;
}

/**
 * „Festgeschriebene Fassungen“ (Board 2b): Festgeschrieben · Von · Stand · In der Akte. Eine zurückgenommene Fassung
 * ist eine gedämpfte Zeile mit Marke und Grund darunter, wie jeder Endzustand; sie bleibt lesbar (Beweismittel).
 * Die Datei öffnet nur, wer die Akte über den Bezug lesen darf (`finance.read`).
 */
export function VersionsTable({ versions, canOpen }: { versions: VersionRow[]; canOpen: boolean }) {
  const t = useTranslations('finance.reports.view.versions');
  const tMuted = useTranslations('common.muted');
  const fmt = useDateFormat();
  // Ohne Fassung nur Überschrift und Satz, kein Tabellenkopf (Designer Runde 7, 249, 261–267).
  if (versions.length === 0) {
    return (
      <Section title={t('title')}>
        <p className="text-meta text-muted-ink">{t('empty')}</p>
      </Section>
    );
  }
  return (
    <Section title={t('title')}>
      <div className="overflow-hidden rounded-md border border-line bg-surface">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead col="title">{t('columns.final')}</TableHead>
              <TableHead col="meta">{t('columns.by')}</TableHead>
              <TableHead col="meta">{t('columns.hash')}</TableHead>
              <TableHead col="meta">{t('columns.document')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {versions.map((v) => {
              const when = fmt.dateTime(v.finalizedAt);
              return (
                <TableRow key={v.reportId} muted={v.voidedAt ? tMuted('withdrawn') : undefined}>
                  <TableCell col="title" mutedMark="inline">
                    {canOpen ? <RowLink href={`/finance/reports/versions/${v.reportId}/file`}>{when}</RowLink> : <span>{when}</span>}
                    <MutedMark />
                    {v.voidedAt ? (
                      <span className="block text-meta text-muted-ink">
                        {v.voidReason ? t('withdrawn', { date: fmt.date(v.voidedAt), reason: v.voidReason }) : t('withdrawnWithoutReason', { date: fmt.date(v.voidedAt) })}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell col="meta">{v.byName}</TableCell>
                  <TableCell col="meta">
                    <KeyLine>{v.shortHash}</KeyLine>
                  </TableCell>
                  <TableCell col="meta" selectable>
                    {v.documentNumber}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </Section>
  );
}
