'use client';

import type { ReportGroup } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Empty } from '@/components/empty-value';
import { FilterBar, frameFilter } from '@/components/filter-bar';
import { MutedMark, RowLink, Table, TableBody, TableCell, TableGroupRow, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DATE_REPORTS, PERIOD_REPORTS } from '@/lib/finance/report-params';

export interface ReportListRow {
  key: string;
  group: ReportGroup;
  available: boolean;
  /** Die jüngste nicht zurückgenommene Fassung des Jahres, fertig als „Datum · Person“; sonst `null`. */
  finalLabel: string | null;
  /** Steuerberichte: der Erklärungszeitraum mit dem Jahr; ohne führt der Link zur Steuererklärung (dort legt man ihn an). */
  periodId?: string | null;
}

/**
 * Wohin eine Zeile führt: Jahr, Stichtag oder — bei den Steuerberichten — der Zeitraum; die Werte der Anlage Gem auf die
 * Seite „Steuererklärung“, die Mittelverwendungsrechnung auf ihre eigene Seite (Plan U2, Muster Anlage Gem).
 */
export function reportRowHref(row: Pick<ReportListRow, 'key' | 'periodId'>, yearId: string): string {
  if (row.key === 'fundsUse') return `/finance/fund-use?year=${encodeURIComponent(yearId)}`;
  if (PERIOD_REPORTS.includes(row.key)) {
    if (!row.periodId) return '/finance/tax';
    const period = encodeURIComponent(row.periodId);
    return row.key === 'taxReturnGem' ? `/finance/tax?period=${period}` : `/finance/reports/${row.key}?period=${period}`;
  }
  return DATE_REPORTS.includes(row.key) ? `/finance/reports/${row.key}` : `/finance/reports/${row.key}?year=${encodeURIComponent(yearId)}`;
}

/**
 * Die Gruppen in der Folge des Jahres (Spec § „Seite Berichte“, Board 2a). „Öffentlichkeit“ direkt nach der
 * Mitgliederversammlung (Plan U1): Leser der Jahresrechnung sind Mitglieder wie bei der MV, die Gruppe verlangt dieselbe Freigabe.
 */
const GROUPS: readonly ReportGroup[] = ['assembly', 'public', 'audit', 'taxOffice', 'work'];

/**
 * Katalog der Berichte (Board 2a, Designer Runde 2): Gruppen als `TableGroupRow`, je Bericht Titel mit Unterzeile und
 * „Festgeschrieben“ als Text. Keine Stufen-Marke — die Stufe folgt aus dem Jahr und steht einmal im Kopf —, keine
 * Zeilenaktionen. Was noch nicht verfügbar ist (ein künftiger Bericht), ist eine gedämpfte Zeile ohne Link.
 */
export function ReportList({ rows, years, yearId }: { rows: ReportListRow[]; years: { id: string; designation: string }[]; yearId: string }) {
  const t = useTranslations('finance.reports');
  const tMuted = useTranslations('common.muted');
  const router = useRouter();
  const [, startNavigation] = useTransition();
  const go = (value: string) => startNavigation(() => router.replace(`/finance/reports?year=${encodeURIComponent(value)}`));
  // Das Jahr grenzt den Bestand nur ab: ein Rahmen, kein gesetzter Filter (MUSTER § L).
  const slot = frameFilter({ key: 'year', label: t('list.yearChoice'), value: yearId, options: years.map((y) => ({ value: y.id, label: y.designation })), onChange: go });
  const groups = GROUPS.map((group) => ({ group, rows: rows.filter((r) => r.group === group) })).filter((g) => g.rows.length > 0);
  return (
    <div className="space-y-3">
      <FilterBar
        filters={[slot]}
        onApply={(values) => (values.year ? go(values.year) : undefined)}
        count={{ shown: rows.length, total: rows.length, noun: { one: t('list.noun.one'), other: t('list.noun.other'), dative: t('list.noun.dative') } }}
        onReset={() => undefined}
        testId="reports-year"
      />
      <div className="overflow-hidden rounded-md border border-line bg-surface">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead col="title">{t('list.columns.report')}</TableHead>
              <TableHead col="meta">{t('list.columns.final')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map(({ group, rows: inGroup }) => [
              <TableGroupRow key={group} colSpan={2} testId="report-group">
                {t(`groups.${group}`)}
              </TableGroupRow>,
              ...inGroup.map((row) =>
                row.available ? (
                  <TableRow key={row.key}>
                    <TableCell col="title">
                      <RowLink href={reportRowHref(row, yearId)}>{t(`${row.key}.title`)}</RowLink>
                      <span className="block text-meta text-muted-ink">{t(`${row.key}.description`)}</span>
                    </TableCell>
                    <TableCell col="meta" wrap>
                      {/* Am Telefon fehlt der Spaltenkopf: das Wort steht davor (Designer Runde 7, 239). */}
                      {row.finalLabel ? (
                        <>
                          {/* Geschütztes Leerzeichen: Die Kartenzeile setzt das `span` als `inline-flex`, ein normales Leerzeichen am
                              Ende fiel dort weg („festgeschrieben25.02.2026“, Designer Runde 8, 248). */}
                          <span className="md:hidden">{`${t('list.finalPrefix')}\u00a0`}</span>
                          {row.finalLabel}
                        </>
                      ) : (
                        <Empty />
                      )}
                    </TableCell>
                  </TableRow>
                ) : (
                  <TableRow key={row.key} muted={tMuted('later')}>
                    <TableCell col="title" mutedMark="inline">
                      <span>{t(`${row.key}.title`)}</span>
                      <MutedMark />
                      <span className="block text-meta text-muted-ink">{t(`${row.key}.description`)}</span>
                    </TableCell>
                    <TableCell col="meta" wrap>
                      <Empty />
                    </TableCell>
                  </TableRow>
                ),
              ),
            ])}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
