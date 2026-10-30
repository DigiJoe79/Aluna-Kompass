'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useDateFormat } from '@/components/date-format-provider';
import { StatusBadge } from '@/components/status-badge';
import { RowLink, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { SectionSummary } from '@/lib/finance/audit-package';
import { AUDIT_SECTION_ORDER } from '@/lib/finance/audit-sections';
import { joinNames } from './audit-header';

/** Der Satz der Spalte „Fortschritt“ — ohne Nullen (MUSTER § G, Leere Werte und Nullen). */
export function useProgressText() {
  const tp = useTranslations('finance.audit.package.progress');
  return (s: SectionSummary): string => {
    const c = s.counts;
    const n = (key: string) => c[key] ?? 0;
    const parts: string[] = (() => {
      switch (s.section) {
        case 'journal':
          return n('samples') > 0 ? [tp('samples', { count: n('samples') })] : [];
        case 'reconciliation':
          return [n('off') > 0 ? tp('reconciliationOff', { count: n('off') }) : tp('reconciliationOk')];
        case 'vouchers': {
          const found = [n('missing') > 0 ? tp('missing', { count: n('missing') }) : null, n('own') > 0 ? tp('own', { count: n('own') }) : null, n('withoutEntry') > 0 ? tp('withoutEntry', { count: n('withoutEntry') }) : null, n('revoked') > 0 ? tp('revoked', { count: n('revoked') }) : null].filter((p): p is string => Boolean(p));
          return found.length > 0 ? found : [tp('vouchersOk')];
        }
        case 'imports':
          return [n('open') > 0 ? tp('importsOpen', { count: n('open') }) : tp('importsOk'), ...(n('decisions') > 0 ? [tp('decisions', { count: n('decisions') })] : [])];
        case 'anomalies':
          return [tp('anomalies', { count: n('total') })];
        case 'purposesReserves':
          // Auch ohne Inhalt ein Stand (260): „keine Zwecke, keine Rücklagen“, wie „keine Zahlungen“ bei 8.
          if (n('purposes') === 0 && n('reserves') === 0) return [tp('purposesReservesNone')];
          return [n('purposes') > 0 ? tp('purposes', { count: n('purposes') }) : null, n('reserves') > 0 ? tp('reserves', { count: n('reserves') }) : null].filter((p): p is string => Boolean(p));
        case 'donations':
          return n('count') > 0 ? [tp('donations', { count: n('count') })] : [];
        case 'partnerPayments':
          return [tp('partnerPayments', { count: n('total') })];
        case 'resolutions':
          // „4 Beschlüsse · 1 abgelehnt“, leer „keine Beschlüsse“ (Designer 2026-10-29).
          return [tp('resolutions', { count: n('total') }), ...(n('rejected') > 0 ? [tp('resolutionsRejected', { count: n('rejected') })] : [])];
      }
    })();
    if (s.remarksOpen > 0) parts.push(tp('remarks', { count: s.remarksOpen }));
    if (s.remarksAnswered) parts.push(tp('remarksAnswered', { count: s.remarksAnswered }));
    return parts.join(' · ');
  };
}

/**
 * Wo „Hier weiter ›“ steht — eine Entscheidung für beide Breiten (Designer Runde 7, 273): der erste Abschnitt, den der
 * Prüfer selbst nicht durchgesehen hat; nach Ablage des Prüfberichts (`auditDone`) und ohne offenen Abschnitt keiner.
 */
export function nextSectionOf(sections: readonly Pick<SectionSummary, 'section' | 'reviewedByMe'>[], auditorView: boolean, auditDone: boolean): SectionSummary['section'] | undefined {
  if (!auditorView || auditDone) return undefined;
  return sections.find((s) => !s.reviewedByMe)?.section;
}

/**
 * Das Prüfpaket auf der Übersicht (Board 4a, 4e): die acht Abschnitte in Prüferreihenfolge, jeder ein Link auf seine
 * Seite, die Frage in Alltagssprache darunter. `RequirementList` kennt weder einen Titel-Link für erledigte Zeilen noch
 * eine Spalte Fortschritt — deshalb eine Tabelle (Plan D1b, Global Constraints). Die Marke sagt nur „durchgesehen“; wer,
 * steht in der Fortschrittszeile („… · durchgesehen von Mira Klein“, Designer Runde 4 Rechenschaft 13a: Eine Marke hat
 * höchstens zwei Wörter). Nach einer Änderung im Abschnitt steht die frühere Durchsicht gedämpft in eigener Zeile darunter.
 * In der Prüferansicht trägt der erste Abschnitt, den er selbst nicht durchgesehen hat, „Hier weiter ›“ — am Desktop in
 * der Spalte rechts, am Telefon als Textlink unter der Fortschrittszeile, damit er nicht mit der Marke konkurriert —,
 * solange die Prüfung des Jahres nicht abgeschlossen ist.
 */
export function PackageTable({ yearId, sections, auditorView, auditDone = false }: { yearId: string; sections: readonly SectionSummary[]; auditorView: boolean; auditDone?: boolean }) {
  const t = useTranslations('finance.audit');
  const tCommon = useTranslations('common');
  const progress = useProgressText();
  const fmt = useDateFormat();
  const next = nextSectionOf(sections, auditorView, auditDone);
  // Die Fortschrittszeile nennt, wer durchgesehen hat; die Marke sagt nur „durchgesehen“.
  const line = (s: SectionSummary) => [progress(s), s.reviewedBy.length > 0 ? t('package.reviewedBy', { names: joinNames(s.reviewedBy, t('head.and')) }) : null].filter(Boolean).join(' · ');
  const href = (section: string) => `/finance/audit/${section}?year=${encodeURIComponent(yearId)}`;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead col="title">{t('package.columns.section')}</TableHead>
          <TableHead col="meta">{t('package.columns.progress')}</TableHead>
          <TableHead col="status">{t('package.columns.state')}</TableHead>
          {auditorView ? (
            <TableHead col="actions">
              <span className="sr-only">{tCommon('rowActionsColumn')}</span>
            </TableHead>
          ) : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sections.map((s) => {
          const n = AUDIT_SECTION_ORDER.indexOf(s.section) + 1;
          return (
            <TableRow key={s.section} data-testid={`package-${s.section}`}>
              <TableCell col="title">
                <RowLink href={href(s.section)}>{t('package.numbered', { n, title: t(`sections.${s.section}.title`) })}</RowLink>
                <span className="block text-meta text-muted-ink">{t(`sections.${s.section}.question`)}</span>
              </TableCell>
              <TableCell col="meta" wrap>
                {line(s) ? <span className="block">{line(s)}</span> : null}
                {s.reviewedBy.length === 0 && s.reviewedBefore ? (
                  // Nachprüfung: Die frühere Durchsicht gilt nicht mehr — gedämpft als Satz, keine Marke (Plan D1d Task 1).
                  <span className="block text-muted-ink">{t('package.reviewedBefore', { names: joinNames(s.reviewedBefore.names, t('head.and')), date: fmt.date(s.reviewedBefore.at) })}</span>
                ) : null}
                {next === s.section ? (
                  <Link href={href(s.section)} className="mt-1 block font-semibold text-link md:hidden">
                    {t('package.here')}
                  </Link>
                ) : null}
              </TableCell>
              <TableCell col="status">
                {s.reviewedBy.length > 0 ? (
                  <StatusBadge tone="neutral" dot>
                    {t('package.reviewed')}
                  </StatusBadge>
                ) : null}
              </TableCell>
              {auditorView ? (
                <TableCell col="actions">
                  {next === s.section ? (
                    <Link href={href(s.section)} className="whitespace-nowrap text-meta font-semibold text-link max-md:hidden">
                      {t('package.here')}
                    </Link>
                  ) : null}
                </TableCell>
              ) : null}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
