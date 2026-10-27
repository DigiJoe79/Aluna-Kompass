'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { EmptyState } from '@/components/empty-state';
import { FilterBar, selectFilter } from '@/components/filter-bar';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import type { RemarkThreadItem } from '@/components/remark-thread';
import { Section } from '@/components/section';
import { StatusBadge, statusTone } from '@/components/status-badge';
import { RowLink, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { RemarkListRow } from '@/lib/finance/audit-remarks';
import { useUrlFilters } from '@/lib/use-url-filters';
import { AuditRemarks } from './audit-remarks';

const STATES = ['open', 'answered', 'resolved'] as const;

/**
 * Abschnitt „Vermerke“ der Übersicht (Board 4a): alle Vermerke des Jahres — Vermerk · An · Von · Zustand — mit dem
 * Filter „Zustand“; die Zeile führt dorthin, wo der Vermerk steht (Buchung, Bericht, Jahr). Die Vermerke zum Jahr
 * stehen darunter als `RemarkThread`, weil sie keine andere Seite haben; ihre Zeile und „Jahr 2025“ in der Spalte „An“
 * springen dorthin (Designer Runde 4).
 */
export function RemarksSection({ rows, yearItems, canAnswer, canAudit }: { rows: RemarkListRow[]; yearItems: RemarkThreadItem[]; canAnswer: boolean; canAudit: boolean }) {
  const t = useTranslations('finance.audit.remarks');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [filters, setFilters] = useUrlFilters({ remarks: params.get('remarks') ?? '' });
  const apply = (remarks: string) => {
    setFilters({ remarks });
    const next = new URLSearchParams(params.toString());
    if (remarks) next.set('remarks', remarks);
    else next.delete('remarks');
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };
  const shown = filters.remarks ? rows.filter((r) => r.state === filters.remarks) : rows;
  return (
    <FormCard as="section">
      <FormCardBody>
        <Section title={t('title')}>
          {rows.length === 0 ? (
            <p className="text-meta text-muted-ink">{t('empty')}</p>
          ) : (
            <div className="flex flex-col gap-3">
              <FilterBar
                filters={[selectFilter({ key: 'remarks', label: t('filterState'), value: filters.remarks, options: STATES.map((s) => ({ value: s, label: t(`state.${s}`) })), onChange: apply })]}
                onApply={(values) => apply(values.remarks ?? '')}
                count={{ shown: shown.length, total: rows.length, noun: { one: t('noun.one'), other: t('noun.other'), dative: t('noun.dative') } }}
                onReset={() => apply('')}
                testId="audit-remarks-filters"
              />
              {shown.length === 0 ? (
                <EmptyState filtered={{ noun: t('filteredNoun'), onReset: () => apply('') }} />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead col="title">{t('columns.remark')}</TableHead>
                      <TableHead col="meta">{t('columns.target')}</TableHead>
                      <TableHead>{t('columns.from')}</TableHead>
                      <TableHead col="status">{t('columns.state')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shown.map((r) => (
                      // Geklärt steht wie jeder Vermerk: Text als Link, Zustand in der Spalte „Zustand“ (Designer Runde 7, 272/273;
                      // Befund 23c — als gedämpfte Zeile färbte `tr[data-muted] [data-row-link]` den Link grau, die Marke stand am Text).
                      <TableRow key={r.id} data-testid="audit-remark-row">
                        <TableCell col="title">
                          <span className="block text-meta text-muted-ink">{r.kindLabel}</span>
                          {(r.inPageHref ?? r.targetHref) ? <RowLink href={r.inPageHref ?? r.targetHref ?? ''}>{r.text}</RowLink> : <span>{r.text}</span>}
                        </TableCell>
                        <TableCell col="meta" wrap>
                          {/* Vermerke zum Jahr stehen darunter im Verlauf: „Jahr 2025“ führt dorthin (Designer Runde 4). */}
                          {r.inPageHref ? (
                            <Link href={r.inPageHref} className="text-link underline-offset-2 hover:underline">
                              {r.targetLabel}
                            </Link>
                          ) : (
                            r.targetLabel
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="block">{r.from}</span>
                          {r.via ? <span className="block text-hint text-muted-ink">{r.via}</span> : null}
                        </TableCell>
                        <TableCell col="status">
                          <StatusBadge tone={statusTone('remark', r.state)} dot>
                            {r.stateLabel}
                          </StatusBadge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          )}
        </Section>
        {yearItems.length > 0 ? (
          <Section title={t('yearTitle')} headingId="vermerke-jahr">
            <AuditRemarks items={yearItems} canAnswer={canAnswer} canAudit={canAudit} />
          </Section>
        ) : null}
      </FormCardBody>
    </FormCard>
  );
}
