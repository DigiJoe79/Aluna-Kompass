'use client';

import { keepSectionSign } from '@kompass/module-finance/format';
import { VAT_FIGURE_GROUP_TITLES, euroBase } from '@kompass/module-finance/vat-forms';
import { useTranslations } from 'next-intl';
import { Fragment } from 'react';
import { Empty } from '@/components/empty-value';
import { Section } from '@/components/section';
import { Table, TableBody, TableCell, TableGroupRow, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatAmount } from '@/lib/finance/amount';
import { BASE_OF_TAX, type VatFigureRow } from '@/lib/finance/vat-figures';
import { cn } from '@/lib/utils';
import { originNode } from '../tax/gem-values-table';

/** Der Wert wie in ELSTER: Bemessungsgrundlage in vollen Euro, Steuer mit Cent, Kz 10 als „1“. */
function figureText(row: Pick<VatFigureRow, 'unit'>, cents: number): string {
  if (row.unit === 'flag') return String(cents);
  if (row.unit === 'euro') return formatAmount(euroBase(cents) * 100).replace(/,00$/, '');
  return formatAmount(cents);
}

/**
 * Kennzahlen der Voranmeldung (Board 8a/8b, Muster `GemValuesTable` 16c): feste Spalten Kz · Angabe · Wert · Herkunft,
 * Gruppenzeilen, nur Kennzahlen mit Wert. Bei offener Berichtigung eine Spalte „abgegeben“ vor „berichtigt“; geänderte
 * Werte in `ink` und fett, gleiche gedämpft, Kz 10 als erste Zeile. Die Herkunft verlinkt ins Journal (`?ids=`).
 */
export function VatFiguresTable({ rows, amendment, filedMissing, notes }: { rows: readonly VatFigureRow[]; amendment: boolean; /** Abgabe ohne Abbild (vor E6b): „abgegeben“ bleibt leer, mit Satz. */ filedMissing: boolean; notes: readonly string[] }) {
  const t = useTranslations('finance.vat.figures');
  const cols = amendment ? 6 : 5;
  const bySource = new Map(rows.map((r) => [r.source, r] as const));
  const origin = (row: VatFigureRow) => {
    if (row.source === 'amended') return <Empty />;
    if (row.source === 'result') return t('sum');
    const base = BASE_OF_TAX[row.source] ? bySource.get(BASE_OF_TAX[row.source]!) : undefined;
    if (base && base.cents !== 0) {
      const rate = Math.round((row.cents * 100) / base.cents);
      return Number.isFinite(rate) && rate > 0 ? t('rateOf', { rate, code: base.code }) : t('taxOf', { code: base.code });
    }
    return originNode(row.entryIds.length > 0 ? `/finance/entries?ids=${row.entryIds.join(',')}` : null, t('entries', { count: row.entryIds.length }));
  };
  const groups = [...new Set(rows.map((r) => r.group))];
  return (
    <Section title={t('title')}>
      <div className="overflow-hidden rounded-md border border-line bg-surface" data-testid="vat-figures">
        <Table>
          <TableHeader>
            <TableRow>
              {/* Die Kennzahl ohne Rolle: Unter `lg` steht sie vor dem Text („84 · …“, Designer Runde 8 wie 16c), damit
                  am Telefon darunter Herkunft und Wert eine Zeile bilden. */}
              <TableHead className="w-14 max-lg:hidden">{t('columns.code')}</TableHead>
              <TableHead col="title">{t('columns.label')}</TableHead>
              {amendment ? (
                <TableHead col="amount" className="w-30 text-right">
                  {t('columns.filed')}
                </TableHead>
              ) : null}
              <TableHead col="amount" className="w-30 text-right">
                {amendment ? t('columns.amended') : t('columns.value')}
              </TableHead>
              <TableHead col="status">
                <span className="sr-only">{t('columns.origin')}</span>
              </TableHead>
              <TableHead col="meta" className="w-50">
                {t('columns.origin')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell col="span" colSpan={cols}>
                  <span className="text-muted-ink">{t('empty')}</span>
                </TableCell>
              </TableRow>
            ) : null}
            {groups.map((group) => (
              <Fragment key={group}>
                {group !== 'general' ? <TableGroupRow colSpan={cols}>{keepSectionSign(VAT_FIGURE_GROUP_TITLES[group])}</TableGroupRow> : null}
                {rows
                  .filter((r) => r.group === group)
                  .map((row) => {
                    const tone = amendment ? (row.changed ? 'font-semibold text-ink' : 'text-muted-ink') : undefined;
                    return (
                      <TableRow key={`${row.code}-${row.source}`} data-figure={row.code}>
                        <TableCell className="max-lg:hidden">{row.code}</TableCell>
                        <TableCell col="title">
                          <span className="font-mono lg:hidden">{`${row.code} · `}</span>
                          {row.label}
                        </TableCell>
                        {amendment ? (
                          <TableCell col="amount" className="text-right tabular-nums">
                            {row.filedCents === null ? <Empty /> : <span className="text-muted-ink">{figureText(row, row.filedCents)}</span>}
                          </TableCell>
                        ) : null}
                        <TableCell col="amount" className="text-right tabular-nums">
                          <span className={cn(tone)} data-changed={amendment && row.changed ? '' : undefined}>
                            {figureText(row, row.cents)}
                          </span>
                        </TableCell>
                        {/* Leer: Sie hält am Telefon den Wert in der Zeile der Herkunft (wie die Anlage Gem, 16c). */}
                        <TableCell col="status" />
                        <TableCell col="meta">{origin(row)}</TableCell>
                      </TableRow>
                    );
                  })}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="mt-2 flex flex-col gap-1 text-meta text-muted-ink">
        {amendment && filedMissing ? <p data-testid="vat-filed-missing">{t('filedMissing')}</p> : null}
        {notes.map((note) => (
          <p key={note}>{keepSectionSign(note)}</p>
        ))}
      </div>
    </Section>
  );
}
