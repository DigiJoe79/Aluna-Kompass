'use client';

import type { AuditSection, AuditSectionRow } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { Fragment, useTransition, type ReactNode } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { Empty } from '@/components/empty-value';
import { EmptyState } from '@/components/empty-state';
import { AmountCell } from '@/components/finance/amount-cell';
import { checkFilter, FilterBar, selectFilter } from '@/components/filter-bar';
import { ListPager } from '@/components/list-pager';
import { SearchField } from '@/components/search-field';
import { StatusBadge, statusTone } from '@/components/status-badge';
import { RowLink, Table, TableBody, TableCell, TableGroupRow, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatEuro } from '@/lib/finance/amount';
import { SECTION_PAGE_SIZE } from '@/lib/finance/audit-sections';
import { useUrlFilters } from '@/lib/use-url-filters';
import { RemarkWriter, type RemarkWriterProps } from '../remark-writer';
import { SampleCheckbox } from './sample-checkbox';

/** Abschnitte, deren Zeilen Buchungen sind — dort gibt es Stichproben. */
const WITH_SAMPLES: readonly AuditSection[] = ['journal', 'vouchers', 'anomalies'];

type Filters = { text: string; sample: string; account: string; ids: string };

type Column = { key: string; role?: 'title' | 'meta' | 'amount' | 'status'; head: string; wrap?: boolean; cell: (r: AuditSectionRow) => ReactNode };

/** Abschnitt 9 (G-30): Link je Protokoll (`null`: Nummer ohne Link) und „Vermerk …“ für Prüfer des Jahres. */
export interface ResolutionExtras {
  minutesHrefs: Record<string, string | null>;
  writer: Omit<RemarkWriterProps, 'target'> | null;
}

/**
 * Eine Liste des Prüfpakets (Board 4b): je Abschnitt eigene Spalten aus den Werten des Dienstes (`kind`,
 * `labelParams`), Öffnen über `RowLink` bis zur Buchung (mit Rückweg auf den Abschnitt). In der Prüferansicht das
 * Kästchen „Stichprobe“ am Platz `select` (N4); die Schatzmeisterin sieht dort nichts. Die Statusspalte trägt nur
 * „erneut prüfen“ und offene Vermerke. Auffälligkeiten stehen in Gruppen je Art.
 */
export function SectionTable({
  yearId,
  designation,
  section,
  auditorView,
  rows,
  accounts,
  filters: fromUrl,
  total,
  unfiltered,
  offset,
  userNames = {},
  fixed = false,
  resolution,
}: {
  yearId: string;
  designation: string;
  section: AuditSection;
  auditorView: boolean;
  rows: AuditSectionRow[];
  accounts: { id: string; name: string }[];
  filters: Filters;
  total: number;
  unfiltered: number;
  offset: number;
  /** Namen zu Nutzer-IDs in den Werten (Wiederöffnung, Verknüpfung). */
  userNames?: Record<string, string>;
  /** Prüfbericht abgelegt: Stichproben stehen fest (274/279). */
  fixed?: boolean;
  resolution?: ResolutionExtras;
}) {
  const t = useTranslations('finance.audit.section');
  const tRoles = useTranslations('contacts.roleNames');
  const tKind = useTranslations('finance.accounts.kind');
  const tRemarks = useTranslations('finance.audit.remarks');
  const fmt = useDateFormat();
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const [filters, setFilters] = useUrlFilters<Filters>(fromUrl);

  const hrefFor = (values: Filters, nextOffset = 0) => {
    const next = new URLSearchParams({ year: yearId });
    if (values.text.trim()) next.set('q', values.text.trim());
    if (values.sample) next.set('sample', values.sample);
    if (values.account) next.set('account', values.account);
    if (values.ids) next.set('ids', values.ids);
    if (nextOffset > 0) next.set('offset', String(nextOffset));
    return `${pathname}?${next.toString()}`;
  };
  const apply = (patch: Partial<Filters>) => {
    const merged = { ...filters, ...patch };
    setFilters(merged);
    startTransition(() => router.replace(hrefFor(merged)));
  };
  const reset = () => apply({ text: '', sample: '', account: '', ids: '' });
  const filtered = Boolean(filters.text.trim() || filters.sample || filters.account || filters.ids);

  const samples = auditorView && WITH_SAMPLES.includes(section);
  const slots = [
    ...(samples
      ? [selectFilter({ key: 'sample', label: t('sample'), value: filters.sample, options: (['sampled', 'open', 'recheck'] as const).map((v) => ({ value: v, label: t(`sampleOptions.${v}`) })), onChange: (sample) => apply({ sample }) })]
      : []),
    ...(section === 'journal' && accounts.length > 1 ? [selectFilter({ key: 'account', label: t('account'), value: filters.account, options: accounts.map((a) => ({ value: a.id, label: a.name })), onChange: (account) => apply({ account }) })] : []),
  ];

  const p = (r: AuditSectionRow, key: string) => r.labelParams[key];
  const str = (r: AuditSectionRow, key: string) => {
    const v = p(r, key);
    return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
  };
  const day = (value: string | null | undefined) => (value ? fmt.date(value) : null);
  const cents = (r: AuditSectionRow, key: string) => {
    const v = p(r, key);
    return typeof v === 'number' ? <AmountCell cents={v} /> : <Empty />;
  };

  // Nummer einzeilig auch in der Kartenzeile, deren Unterzeile sonst am Bindestrich bricht (MUSTER § G, Befund 23f).
  const number: Column = { key: 'number', role: 'meta', head: t('columns.number'), cell: (r) => <span className="whitespace-nowrap font-mono text-meta">{str(r, 'number') || str(r, 'paymentNumber') || <Empty />}</span> };
  const date: Column = { key: 'date', role: 'meta', head: t('columns.date'), cell: (r) => <span className="tabular-nums text-meta text-ink-2">{day(r.date) ?? <Empty />}</span> };
  const amount: Column = { key: 'amount', role: 'amount', head: t('columns.amount'), cell: (r) => (r.amountCents === null ? <Empty /> : <AmountCell cents={r.amountCents} />) };

  const anomalyText = (r: AuditSectionRow): string => {
    switch (r.kind) {
      case 'relatedParty':
        return t('anomaly.relatedParty', { name: str(r, 'contactName'), role: tRoles(str(r, 'role')) });
      case 'reversal':
        return t('anomaly.reversal', { number: str(r, 'reversedNumber') });
      case 'correction':
        return p(r, 'section153') === true ? t('anomaly.correction153', { year: str(r, 'entryYear') }) : t('anomaly.correction', { year: str(r, 'entryYear') });
      case 'lateFinalized':
        return t('anomaly.lateFinalized', { date: day(str(r, 'finalizedOn')) ?? '', days: Number(p(r, 'days') ?? 0) });
      case 'cashShortfall':
        return t('anomaly.cashShortfall', { number: str(r, 'documentNumber') });
      case 'cashNegative':
        return str(r, 'until') ? t('anomaly.cashNegative', { account: str(r, 'accountName'), from: day(str(r, 'from')) ?? '', until: day(str(r, 'until')) ?? '' }) : t('anomaly.cashNegativeOpen', { account: str(r, 'accountName'), from: day(str(r, 'from')) ?? '' });
      case 'partnerPaymentReason':
        return t('anomaly.partnerPaymentReason', { number: str(r, 'paymentNumber'), reasons: str(r, 'reasons').split(',').filter(Boolean).map((code) => t(`partnerReason.${code}`)).join(', ') });
      case 'evidenceReused':
        return t('anomaly.evidenceReused', { uses: str(r, 'uses') });
      case 'reopened':
        return t('anomaly.reopened', { name: userNames[str(r, 'byUserId')] ?? '' });
      case 'userLink':
        return p(r, 'selfLinked') === true ? t('anomaly.userLinkSelf', { name: userNames[str(r, 'userId')] ?? '' }) : t('anomaly.userLink', { name: userNames[str(r, 'userId')] ?? '' });
      case 'priorYearCarryOver':
        // Designer Runde 8, 286: ein Satz statt des Schlüssels.
        return t('anomaly.priorYearCarryOver', { change: str(r, 'change'), number: str(r, 'number'), year: str(r, 'year') });
      case 'cashPayout':
      case 'roundAmount':
      case 'cashDonation':
      case 'finalizedByAgent':
        return t(`anomaly.${r.kind}`);
      default:
        // Eine neue Art ohne Satz: lieber die Gruppe als der Schlüssel (Test über alle Arten).
        return t.has(`anomalyKind.${r.kind}`) ? t(`anomalyKind.${r.kind}`) : '';
    }
  };

  const titleOf = (r: AuditSectionRow): { text: string; sub?: string | null } => {
    switch (section) {
      case 'journal': {
        const state = str(r, 'state');
        return { text: str(r, 'text'), sub: state === 'reversed' || state === 'reversal' ? t(`entryState.${state}`) : null };
      }
      case 'reconciliation':
        return { text: str(r, 'accountName'), sub: tKind(str(r, 'kind')) };
      case 'vouchers':
        return { text: t(`voucherReason.${str(r, 'reason')}`), sub: str(r, 'subject') || null };
      case 'imports': {
        const kind = str(r, 'kind');
        return { text: str(r, 'counterparty') || str(r, 'purpose') || str(r, 'accountName'), sub: kind === 'decision' && str(r, 'counterparty') ? str(r, 'purpose') || null : null };
      }
      case 'anomalies':
        return { text: anomalyText(r) };
      case 'purposesReserves':
        return { text: str(r, 'name'), sub: t(`purposeKind.${r.kind}`) };
      case 'donations':
        return { text: t(`donationKind.${str(r, 'kind')}`) };
      case 'partnerPayments':
        return { text: str(r, 'partnerName') };
      case 'resolutions':
        return { text: t(`resolution.kind.${str(r, 'resolutionKind')}`) };
    }
  };

  /**
   * Die Angaben eines Beschlusses (Designer 2026-10-29): Werte mit „ · “ in fester Reihenfolge je Art, Betrag zuerst;
   * eine fehlende Angabe fällt samt Trenner weg.
   */
  const factsOf = (r: AuditSectionRow): string => {
    const amount = typeof p(r, 'amountCents') === 'number' ? formatEuro(p(r, 'amountCents') as number) : null;
    const validFrom = str(r, 'validFrom') ? t('resolution.validFrom', { date: day(str(r, 'validFrom')) ?? '' }) : null;
    const fiscalYear = str(r, 'fiscalYear') ? t('resolution.fiscalYear', { year: str(r, 'fiscalYear') }) : null;
    const parts = ((): (string | null)[] => {
      switch (str(r, 'resolutionKind')) {
        case 'discharge':
          return [fiscalYear, p(r, 'collective') === true ? t('resolution.collective') : str(r, 'persons') || null];
        case 'accounts':
          return [fiscalYear];
        case 'remuneration':
          return [amount ? t(str(r, 'remunerationMode') === 'activity' ? 'resolution.amountPerActivity' : 'resolution.amountPerYear', { amount }) : null, str(r, 'organs') || null, validFrom];
        case 'expenseRule':
          return [str(r, 'expenseBasis') ? t(`resolution.expenseBasis.${str(r, 'expenseBasis')}`) : null, validFrom];
        case 'reserve': {
          const action = str(r, 'reserveAction');
          return [amount, str(r, 'reserveType') ? t(`resolution.reserveType.${str(r, 'reserveType')}`) : null, action && action !== 'create' ? t(`resolution.reserveAction.${action}`) : null];
        }
        case 'feeSchedule':
          return [validFrom];
        default:
          return [];
      }
    })();
    return parts.filter((v): v is string => Boolean(v)).join(' · ');
  };

  const title: Column = {
    key: 'title',
    role: 'title',
    head: { journal: t('columns.text'), reconciliation: t('columns.account'), vouchers: t('columns.reason'), imports: t('columns.transaction'), anomalies: t('columns.hint'), purposesReserves: t('columns.name'), donations: t('columns.donations'), partnerPayments: t('columns.partner'), resolutions: t('columns.kind') }[section],
    cell: (r) => {
      const { text, sub } = titleOf(r);
      const href = r.entryId ? `/finance/entries/${r.entryId}?from=audit&section=${section}&year=${encodeURIComponent(yearId)}` : r.documentId ? `/dms/${r.documentId}` : null;
      const label = str(r, 'number') ? `${str(r, 'number')} · ${text}` : text;
      return (
        <>
          {href ? (
            <RowLink href={href} aria-label={label}>
              {text || <Empty />}
            </RowLink>
          ) : (
            <span>{text || <Empty />}</span>
          )}
          {sub ? <span className="block text-hint text-muted-ink">{sub}</span> : null}
        </>
      );
    },
  };

  const columns: Column[] = (() => {
    switch (section) {
      case 'journal':
        // „Wofür“ ist Text: `meta` mit `wrap` hält seine Mindestbreite über die Rolle (262/263).
        return [number, date, title, { key: 'purpose', role: 'meta', wrap: true, head: t('columns.purpose'), cell: (r) => str(r, 'purposeOrCategory') || <Empty /> }, amount];
      case 'reconciliation':
        return [
          title,
          { key: 'against', head: t('columns.against'), cell: (r) => (typeof p(r, 'againstCents') === 'number' ? `${formatEuro(p(r, 'againstCents') as number)} · ${t(`againstSource.${str(r, 'source')}`, { date: day(r.date) ?? '' })}` : t('againstSource.none')) },
          { key: 'reconciliation', role: 'meta', wrap: true, head: t('columns.reconciliation'), cell: (r) => t(`reconciliationState.${str(r, 'state')}`) },
          { ...amount, head: t('columns.book') },
        ];
      case 'vouchers':
        return [number, date, title];
      case 'imports':
        return [date, title, { key: 'decision', role: 'meta', wrap: true, head: t('columns.decision'), cell: (r) => t(`importKind.${str(r, 'kind') === 'open' ? 'open' : str(r, 'decision')}`) }, amount];
      case 'anomalies':
        return [number, date, title, amount];
      case 'purposesReserves':
        return [title, { key: 'carry', head: t('columns.carryForward'), cell: (r) => cents(r, 'carryForwardCents') }, { key: 'inflow', head: t('columns.inflow'), cell: (r) => cents(r, 'inflowCents') }, { key: 'used', head: t('columns.used'), cell: (r) => cents(r, 'usedCents') }, { ...amount, head: t('columns.closing') }];
      case 'donations':
        return [title, { key: 'count', role: 'meta', head: t('columns.count'), cell: (r) => <span className="tabular-nums">{str(r, 'count')}</span> }, amount];
      case 'partnerPayments':
        return [
          number,
          date,
          title,
          {
            key: 'proof',
            role: 'meta',
            wrap: true,
            head: t('columns.proof'),
            cell: (r) => {
              const state = str(r, 'proofState');
              const due = day(str(r, 'proofDueOn'));
              return state === 'open' && !due ? t('proofState.openNoDate') : t(`proofState.${state}`, { date: due ?? '' });
            },
          },
        ];
      case 'resolutions':
        // Designer 2026-10-29: Nummer · Datum · Art · Angaben · Organ · Ergebnis · Protokoll · Stand. Am Telefon Art und
        // Ergebnis oben, darunter Nummer · Datum · Organ, die Angaben, dann Protokoll und Stand.
        return [
          number,
          date,
          title,
          { key: 'facts', role: 'meta', wrap: true, head: t('columns.facts'), cell: (r) => factsOf(r) || <Empty /> },
          { key: 'organ', role: 'meta', head: t('columns.organ'), cell: (r) => (p(r, 'viaCircular') === true ? t('resolution.circular') : str(r, 'organ') || <Empty />) },
          {
            key: 'outcome',
            role: 'status',
            head: t('columns.outcome'),
            // „angenommen“ ist der Normalzustand ohne Marke, „abgelehnt“ `neutral` — wie in der Beschlussliste (MUSTER § F).
            cell: (r) => (str(r, 'outcome') === 'rejected' ? <StatusBadge tone={statusTone('resolution', 'rejected')} dot>{t('resolution.outcome.rejected')}</StatusBadge> : null),
          },
          {
            key: 'minutes',
            role: 'meta',
            wrap: true,
            head: t('columns.minutes'),
            cell: (r) => {
              const minutes = str(r, 'minutesNumber');
              if (!minutes) return <Empty />;
              const href = r.resolutionId ? (resolution?.minutesHrefs[r.resolutionId] ?? null) : null;
              // Nummer als Link in den Dokumentbetrachter, wie „Öffnen“ bei Belegen; kein Link auf den Beschluss selbst.
              return href ? (
                <a href={href} target="_blank" rel="noreferrer" className="whitespace-nowrap font-mono text-meta text-link underline-offset-2 hover:underline" aria-label={t('resolution.minutesLink', { number: minutes })}>
                  {minutes}
                </a>
              ) : (
                <span className="whitespace-nowrap">{minutes}</span>
              );
            },
          },
          { key: 'stand', role: 'meta', wrap: true, head: t('columns.state'), cell: (r) => remarkState(r) ?? (resolution?.writer && r.resolutionId ? <RemarkWriter {...resolution.writer} target={{ type: 'resolution', id: r.resolutionId, label: tRemarks('target.resolution', { number: str(r, 'number') }) }} /> : null) },
        ];
    }
  })();

  /** Die Marke trägt den Zustand des Vermerks (Designer Runde 7, 274/275): offen vor beantwortet. */
  function remarkState(r: AuditSectionRow): ReactNode {
    if (r.remarksOpen > 0) return <StatusBadge tone={statusTone('remark', 'open')} dot>{t('remarksOpen', { count: r.remarksOpen })}</StatusBadge>;
    if ((r.remarksAnswered ?? 0) > 0) return <StatusBadge tone={statusTone('remark', 'answered')} dot>{t('remarksAnswered', { count: r.remarksAnswered ?? 0 })}</StatusBadge>;
    return null;
  }

  const statusCell = (r: AuditSectionRow) => (
    <div className="flex flex-wrap justify-end gap-1.5">
      {r.sample === 'recheck' && auditorView ? (
        <StatusBadge tone={statusTone('sample', 'recheck')} dot>
          {t('recheck')}
        </StatusBadge>
      ) : null}
      {remarkState(r)}
    </div>
  );
  // Abschnitt 9 trägt Ergebnis und Stand als eigene Spalten (Designer 2026-10-29), die übrigen die Statusspalte am Ende.
  const trailingStatus = section !== 'resolutions';

  const width = columns.length + (trailingStatus ? 1 : 0) + (samples ? 1 : 0);
  const row = (r: AuditSectionRow) => (
    <TableRow key={r.key}>
      {samples ? (
        <TableCell col="select">
          {r.entryId ? <SampleCheckbox key={`${r.entryId}:${r.sample}`} fiscalYearId={yearId} entryId={r.entryId} checked={r.sample === 'sampled'} label={t('sampleLabel', { name: str(r, 'number') || titleOf(r).text })} fixed={fixed} /> : null}
        </TableCell>
      ) : null}
      {columns.map((c) => (
        <TableCell key={c.key} col={c.role} wrap={c.wrap} truncate={c.role === 'title' && section === 'journal' ? true : undefined} title={c.role === 'title' && section === 'journal' ? str(r, 'text') : undefined}>
          {c.cell(r)}
        </TableCell>
      ))}
      {trailingStatus ? <TableCell col="status">{statusCell(r)}</TableCell> : null}
    </TableRow>
  );

  const groups = section === 'anomalies' ? rows.reduce<{ kind: string; rows: AuditSectionRow[] }[]>((out, r) => {
    const last = out.at(-1);
    if (last?.kind === r.kind) last.rows.push(r);
    else out.push({ kind: r.kind, rows: [r] });
    return out;
  }, []) : null;

  return (
    <div className="flex flex-col gap-3">
      <FilterBar
        search={<SearchField value={filters.text} onChange={(text) => apply({ text })} placeholder={t('searchPlaceholder')} placeholderShort={t('searchPlaceholderShort')} />}
        searchActive={filters.text.trim() ? { chip: filters.text.trim(), onClear: () => apply({ text: '' }) } : undefined}
        filters={slots}
        hidden={filters.ids ? [checkFilter({ key: 'ids', label: t('changedOnly'), value: true, onChange: (on) => apply({ ids: on ? filters.ids : '' }) })] : []}
        onApply={(values) => apply(values as Partial<Filters>)}
        count={{ shown: total, total: unfiltered, noun: { one: t('noun.one'), other: t('noun.other'), dative: t('noun.dative') } }}
        onReset={reset}
        testId="audit-section-filters"
      />
      {rows.length === 0 && filtered ? (
        <EmptyState filtered={{ noun: t('filteredNoun'), onReset: reset }} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('empty.title')} text={section === 'resolutions' ? t('empty.resolutions', { year: designation }) : t('empty.text', { year: designation })} />
      ) : (
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <Table>
            <TableHeader>
              <TableRow>
                {samples ? <TableHead col="select" className="w-9"><span className="sr-only">{t('sample')}</span></TableHead> : null}
                {columns.map((c) =>
                  c.role === 'title' ? (
                    <TableHead key={c.key} col="title">
                      {c.head}
                    </TableHead>
                  ) : (
                    <TableHead key={c.key} col={c.role}>
                      {c.head}
                    </TableHead>
                  ),
                )}
                {trailingStatus ? <TableHead col="status">{t('columns.state')}</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups
                ? groups.map((g) => (
                    <Fragment key={g.kind}>
                      <TableGroupRow colSpan={width} testId="anomaly-group">
                        {t(`anomalyKind.${g.kind}`)}
                      </TableGroupRow>
                      {g.rows.map(row)}
                    </Fragment>
                  ))
                : rows.map(row)}
            </TableBody>
          </Table>
          <ListPager total={total} offset={offset} pageSize={SECTION_PAGE_SIZE} hrefFor={(next) => hrefFor(filters, next)} footer />
        </div>
      )}
    </div>
  );
}
