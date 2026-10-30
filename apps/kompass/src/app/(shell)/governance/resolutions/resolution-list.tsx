'use client';

import type { ResolutionRowView } from '@kompass/module-governance';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { Empty } from '@/components/empty-value';
import { EmptyState } from '@/components/empty-state';
import { checkFilter, FilterBar, selectFilter } from '@/components/filter-bar';
import { StatusBadge, statusTone } from '@/components/status-badge';
import { RowLink, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useUrlFilters } from '@/lib/use-url-filters';

type Filters = { organ: string; kind: string; year: string; tax: string };

/** Die Beschlussliste (Board 6a): angenommen ohne Marke, „gegen die Zählung“ `info`; „§ AO“ ist Text, keine Marke. */
export function ResolutionList({ rows, total, organs, kinds, years }: { rows: ResolutionRowView[]; total: number; organs: { id: string; name: string }[]; kinds: { value: string; label: string }[]; years: string[] }) {
  const t = useTranslations('governance.resolutions');
  const tk = useTranslations('governance.agendaKinds');
  const ts = useTranslations('governance.states.resolution');
  const { date } = useDateFormat();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [filters, setFilters] = useUrlFilters<Filters>({ organ: params.get('organ') ?? '', kind: params.get('kind') ?? '', year: params.get('year') ?? '', tax: params.get('tax') ?? '' });
  const apply = (patch: Partial<Filters>) => {
    const merged = { ...filters, ...patch };
    setFilters(merged);
    const next = new URLSearchParams(Object.entries(merged).filter(([, v]) => v !== ''));
    startTransition(() => router.replace(next.size ? `${pathname}?${next.toString()}` : pathname));
  };
  const reset = () => apply({ organ: '', kind: '', year: '', tax: '' });
  const filtered = Object.values(filters).some((v) => v !== '');
  const outcome = (r: ResolutionRowView) => {
    if (r.againstCount) return { status: 'overridden' as const, label: ts('overridden') };
    if (r.outcome && r.outcome !== 'adopted') return { status: r.outcome, label: ts(r.outcome) };
    return null;
  };
  return (
    <div className="flex flex-col gap-3">
      <FilterBar
        filters={[
          selectFilter({ key: 'organ', label: t('filterOrgan'), value: filters.organ, options: organs.map((o) => ({ value: o.id, label: o.name })), onChange: (organ) => apply({ organ }) }),
          selectFilter({ key: 'kind', label: t('filterKind'), value: filters.kind, options: kinds.map((k) => ({ value: k.value, label: tk(k.value) })), onChange: (kind) => apply({ kind }) }),
          selectFilter({ key: 'year', label: t('filterYear'), value: filters.year, options: years.map((y) => ({ value: y, label: y })), onChange: (year) => apply({ year }) }),
          checkFilter({ key: 'tax', label: t('filterTax'), value: filters.tax === '1', onChange: (on) => apply({ tax: on ? '1' : '' }) }),
        ]}
        onApply={(values) => apply(values as Partial<Filters>)}
        count={{ shown: rows.length, total, noun: { one: t('noun.one'), other: t('noun.other'), dative: t('noun.dative') } }}
        onReset={reset}
        testId="resolutions-filters"
      />
      {rows.length === 0 && filtered ? (
        <EmptyState filtered={{ noun: t('filteredNoun'), onReset: reset }} />
      ) : (
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead col="meta">{t('columns.number')}</TableHead>
                <TableHead col="meta">{t('columns.date')}</TableHead>
                <TableHead col="meta">{t('columns.organ')}</TableHead>
                <TableHead col="title">{t('columns.subject')}</TableHead>
                <TableHead>{t('columns.tax')}</TableHead>
                <TableHead col="status">{t('columns.outcome')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const o = outcome(r);
                return (
                  <TableRow key={r.id}>
                    <TableCell col="meta" selectable>
                      <RowLink href={`/governance/resolutions/${r.id}`}>
                        {r.number ? <span className="font-mono">{r.number}</span> : t('noNumber')}
                      </RowLink>
                    </TableCell>
                    <TableCell col="meta">{date(r.decidedOn)}</TableCell>
                    <TableCell col="meta">{r.organKind === 'assembly' ? t('assemblyShort') : r.organName}</TableCell>
                    <TableCell col="title">
                      {r.election ? t('election', { office: r.election.office, names: r.election.elected.join(', ') || t('nobodyElected') }) : r.subject}
                      <span className="block text-meta text-muted-ink">{[tk(r.kind), r.election?.runoff ? t('runoff') : null].filter(Boolean).join(' · ')}</span>
                    </TableCell>
                    <TableCell>{r.taxRelevant ? t('taxMark') : <Empty />}</TableCell>
                    <TableCell col="status">{o ? <StatusBadge tone={statusTone('resolution', o.status)} dot>{o.label}</StatusBadge> : null}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-hint text-muted-ink">{t('taxFootnote')}</p>
    </div>
  );
}
