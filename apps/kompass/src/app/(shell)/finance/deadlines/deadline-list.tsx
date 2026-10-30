'use client';

import type { DeadlineView } from '@kompass/module-finance';
import { vatFilingOpensOn } from '@kompass/module-finance/vat-calendar';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { PageHeader } from '@/components/page-header';
import { Section } from '@/components/section';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { RowLink, Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { VatDialog } from './vat-dialog';
import { vatPeriodLabel, withVatPeriodLabel } from '@/lib/finance/vat-period';
import { formatEuro } from '@/lib/finance/amount';

/** Titel einer berechneten Frist, mit Namen nur, wenn der Dienst sie mitgibt (`finance.read`). */
export function useDeadlineTitle(): (d: DeadlineView) => string {
  const t = useTranslations('finance.deadlines.computed');
  const root = useTranslations();
  return (d) => t(`kinds.${d.kind}`, withVatPeriodLabel(d.params, root));
}

/** E6a: Zeilen mit „Abgabe eintragen …“ — Voranmeldung, Jahreserklärung und Berichtigung der Umsatzsteuer. */
const VAT_FILING_KINDS: readonly DeadlineView['kind'][] = ['vatAdvanceReturn', 'vatReturn', 'vatAmendment'];

/**
 * Abschnitt „Fristen“ (Board 6a): berechnet, ohne Kästchen — Datum (`meta`, überfällig mit Marke `warning`), Frist als
 * `RowLink`, Bezug (`meta`). Nur die Umsatzsteuer hat eine Zeilenarbeit: „Abgabe eintragen …“ an Voranmeldung,
 * Jahreserklärung und Berichtigung (mit `finance.periodClose`) — seit E6a Task 11d (Board Umsatzsteuer 5a) in der
 * Bezugsspalte, keine eigene Aktionsspalte. Der Weg zur Voranmeldung bzw. zu den Summen ist nur der Titel; der Bezug ist Text
 * (Designer Runde 8, Vorweg 3: kein zweiter Link zum selben Ziel). Die Berichtigung hat kein Datum:
 * „unverzüglich“ in `warning`, und eine Unterzeile nennt den Auslöser, wenn der Dienst ihn kennt.
 */
export function DeadlineList({ deadlines, canFileVat, canRead, today }: { deadlines: readonly DeadlineView[]; canFileVat: boolean; /** `finance.read`: ohne das Recht führt der Link auf eine ForbiddenCard, also Text. */ canRead: boolean; today: string }) {
  const t = useTranslations('finance.deadlines.computed');
  const fmt = useDateFormat();
  const title = useDeadlineTitle();
  const [vat, setVat] = useState<DeadlineView | null>(null);
  const root = useTranslations();
  const subject = (d: DeadlineView) => (typeof d.params.partner === 'string' ? t('subjectPartner', { partner: d.params.partner }) : t(`subjects.${d.kind}`, withVatPeriodLabel(d.params, root)));
  const cause = (d: DeadlineView): string | null =>
    d.kind === 'vatAmendment' && typeof d.params.entryNumber === 'string' && typeof d.params.changedOn === 'string'
      ? t('cause', { entryNumber: d.params.entryNumber, change: String(d.params.change ?? 'corrected'), changedOn: fmt.date(d.params.changedOn), more: Number(d.params.more ?? 0) })
      : null;
  const vatPeriod = (d: DeadlineView) => d.key.slice(d.key.indexOf(':') + 1);
  return (
    <Section title={t('title')} intro={t('intro')}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead col="meta">{t('columns.date')}</TableHead>
            <TableHead col="title">{t('columns.deadline')}</TableHead>
            <TableHead col="status">
              <span className="sr-only">{t('overdue')}</span>
            </TableHead>
            <TableHead col="meta" wrap>
              {t('columns.subject')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {deadlines.length === 0 ? <TableEmpty colSpan={4}>{t('empty')}</TableEmpty> : null}
          {deadlines.map((d) => {
            const because = cause(d);
            return (
              <TableRow key={d.key} data-testid="deadline-row" data-kind={d.kind}>
                <TableCell col="meta">{d.dueOn ? fmt.date(d.dueOn) : d.kind === 'vatAmendment' ? <span className="font-semibold text-warning">{t('immediately')}</span> : t('noDate')}</TableCell>
                {/* Die Marke steht direkt hinter dem Text, 8 px (295, wie „folgt später“ in 2a); die Statusspalte bleibt
                    leer und fällt damit weg. */}
                <TableCell col="title">
                  <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                    {canRead ? <RowLink href={d.href}>{title(d)}</RowLink> : <span>{title(d)}</span>}
                    {d.overdue ? <StatusBadge tone="warning" dot>{t('overdue')}</StatusBadge> : null}
                  </span>
                  {because ? <span className="block text-meta text-muted-ink" data-testid="deadline-cause">{because}</span> : null}
                  {/* Verwendungsfrist (Plan U2): der Rest unter dem Titel, an der Stelle des Auslösers. */}
                  {d.kind === 'timelyUse' && typeof d.params.restCents === 'number' ? (
                    <span className="block text-meta text-muted-ink" data-testid="deadline-rest">
                      {t('timelyUseRest', { amount: formatEuro(d.params.restCents) })}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell col="status" />
                <TableCell col="meta" wrap data-testid="deadline-subject">
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span>{subject(d)}</span>
                    {VAT_FILING_KINDS.includes(d.kind) && canFileVat ? (
                      // Vor dem Ende des Zeitraums lehnt der Dienst die Abgabe ab: dann der Tag statt des Knopfs (Befund 33).
                      today < (vatFilingOpensOn(vatPeriod(d)) ?? today) ? (
                        <span className="text-meta text-muted-ink" data-testid="deadline-vat-from">
                          {t('vatFileFrom', { date: fmt.date(vatFilingOpensOn(vatPeriod(d))!) })}
                        </span>
                      ) : (
                        <Button type="button" variant="outline" size="sm" onClick={() => setVat(d)} data-testid="deadline-vat">
                          {t('vatFile')}
                        </Button>
                      )
                    ) : null}
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {vat ? <VatDialog open onOpenChange={(o) => (o ? undefined : setVat(null))} period={vatPeriod(vat)} label={vatPeriodLabel(vatPeriod(vat), root)} today={today} /> : null}
    </Section>
  );
}

/**
 * Kopf (Board 6a, 295): zuerst, was unverzüglich ist (Berichtigung nach § 153 AO, Befund 30 d), dann die überfälligen —
 * „Unverzüglich: …. 2 Fristen überfällig: … und ….“ —, sonst „Nächste Frist: … bis ….“ oder „Keine Frist offen.“ Eine
 * Aufzählung nennt höchstens zwei und endet sonst mit „und n weitere“. Ein Vermerk „Verwendungsfrist entfallen“
 * (`timelyUseLapsed`) ist keine Frist: Er zählt weder als nächste noch als undatierte (Plan U2, Review Focus 4).
 */
export function DeadlinesHeader({ deadlines, approaching, exceeded }: { deadlines: readonly DeadlineView[]; approaching: number; exceeded: number }) {
  const td = useTranslations('finance.deadlines');
  const fmt = useDateFormat();
  const title = useDeadlineTitle();
  const immediate = deadlines.filter((d) => d.kind === 'vatAmendment');
  const overdue = deadlines.filter((d) => d.overdue && d.kind !== 'vatAmendment');
  const next = deadlines.find((d) => d.dueOn !== null) ?? null;
  const undated = deadlines.find((d) => d.dueOn === null && d.kind !== 'vatAmendment' && d.kind !== 'timelyUseLapsed') ?? null;
  // Höchstens zwei mit Namen, dann die Zahl (Designer Runde 8, Abweichung 4): „… und 1 weitere.“ statt „und …“.
  const listed = (list: readonly DeadlineView[]) => ({ count: list.length, first: title(list[0]!), second: list[1] ? title(list[1]) : '', rest: Math.max(0, list.length - 2) });
  const parts = [
    immediate.length > 0 ? td('headImmediate', listed(immediate)) : null,
    overdue.length > 0 ? td('headOverdue', listed(overdue)) : next ? td('headNext', { title: title(next), date: fmt.date(next.dueOn) }) : undated ? td('headNextUndated', { title: title(undated) }) : immediate.length > 0 ? null : td('headNone'),
    exceeded > 0 ? td('headExceeded', { count: exceeded }) : null,
    approaching > 0 ? td('headThresholds', { count: approaching }) : null,
  ].filter(Boolean);
  return <PageHeader title={td('title')} description={<span data-testid="deadlines-head">{parts.join(' ')}</span>} />;
}
