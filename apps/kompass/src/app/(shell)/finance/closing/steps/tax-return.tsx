'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useDateFormat } from '@/components/date-format-provider';
import { StatusBadge } from '@/components/status-badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { RequirementList, type RequirementListItem } from '@/components/requirement-list';
import { VatDialog } from '../../deadlines/vat-dialog';
import { useState } from 'react';
import type { ClosingStepBody } from '../step-body';
import { taxReturnSettled, taxReturnStateOf } from '../step-detail';
import { ConfirmRow } from './confirm-row';

/**
 * Schritt 12 (Board 15h). Ohne Erklärungszeitraum wie in C: „Nur wenn fällig.“ und „Bestätigen …“ mit dem Vorschlag
 * „keine Erklärung angefordert“, daneben „Zur Steuererklärung“ — dort legt man einen Zeitraum an. Das letzte Jahr eines
 * offenen Zeitraums: „Erklärung für … bis …“ mit „Zur Steuererklärung“ (`outline`, die Erklärung ist nicht die
 * Haupthandlung des Abschlusses), überfällig mit Marke; bestätigen lässt es sich dann nicht — es folgt der Abgabe.
 */
export function TaxReturnStep({ step, status, canConfirm, onConfirm, today = '', canFileVat = false }: ClosingStepBody<'taxReturn'> & { /** Heute im Verein, für den Abgabedialog. */ today?: string; /** `finance.periodClose`: „Abgabe eintragen …“ im Schritt (Designer Runde 8, 17e). */ canFileVat?: boolean }) {
  const t = useTranslations('finance.closing.taxReturn');
  const tDeadlines = useTranslations('finance.deadlines.computed');
  const fmt = useDateFormat();
  const [filingVat, setFilingVat] = useState(false);
  const period = step.facts.period;
  // E6a: die USt-Jahreserklärung des Kalenderjahres als zweiter Absatz im Textmuster des Schritts (Board Umsatzsteuer 6a).
  const vat = step.facts.vat;
  const vatOpen = vat !== null && vat.filedOn === null;
  const overdueBadge = (
    <StatusBadge tone="warning" dot testId="closing-tax-vat-overdue">
      {t('overdue')}
    </StatusBadge>
  );
  // Designer Runde 8, 17e: „Abgabe eintragen …“ (derselbe Dialog wie unter Fristen) direkt im Schritt, daneben „Zu den
  // Fristen“ — sonst führte der einzige offene Schritt des Jahres nur auf eine andere Seite.
  const vatFile = vatOpen && canFileVat ? (
    <Button type="button" variant="outline" size="sm" onClick={() => setFilingVat(true)} data-testid="closing-tax-vat-file">
      {tDeadlines('vatFile')}
    </Button>
  ) : null;
  const vatDialog = vatOpen && canFileVat ? <VatDialog open={filingVat} onOpenChange={setFilingVat} period={String(vat.calendarYear)} label={String(vat.calendarYear)} today={today} /> : null;
  const toDeadlines = (
    <Link href="/finance/deadlines" className="text-meta text-link underline-offset-2 hover:underline">
      {t('toDeadlines')}
    </Link>
  );
  const vatLine = vat ? (
    <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-meta text-ink-2" data-testid="closing-tax-vat">
      <span>{vat.filedOn ? t('vatFiled', { year: String(vat.calendarYear), date: fmt.date(vat.filedOn) }) : t('vatDue', { year: String(vat.calendarYear), date: fmt.date(vat.dueOn), reason: vat.reason })}</span>
      {vat.overdue ? overdueBadge : null}
    </p>
  ) : null;
  // Befund 34 a: Ist die Steuererklärung erledigt und fehlt nur die USt-Jahreserklärung, steht oben das Ergebnis
  // (`detail`), im Körper nur der Satz, was fehlt (17e A), mit der Abgabe und dem Link zu den Fristen.
  if (vatLine && taxReturnSettled(step)) {
    return (
      <div className="flex flex-col gap-2.5" data-testid="closing-body-taxReturn">
        {vatLine}
        {vatOpen ? (
          <div className="flex flex-wrap items-center gap-3">
            {vatFile}
            {toDeadlines}
          </div>
        ) : null}
        {vatDialog}
      </div>
    );
  }
  // 17e B: Fehlen zwei Dinge — die Steuererklärung des Zeitraums und die USt-Jahreserklärung —, stehen sie als Zeilen.
  if (period && vatOpen && taxReturnStateOf(step.facts) === 'due') {
    const items: RequirementListItem[] = [
      {
        key: 'taxReturn',
        title: t('rowTax', { period: period.label }),
        detail: fmt.date(period.dueOn),
        done: false,
        blocked: false,
        canSelf: true,
        canDoNames: [],
        canDoText: '',
        href: null,
        actionLabel: '',
        doneLabel: '',
        extra: (
          <>
            {period.overdue ? overdueBadge : null}
            <Link href={`/finance/tax?period=${encodeURIComponent(period.id)}`} className={buttonVariants({ variant: 'outline', size: 'sm' })} data-testid="closing-to-tax">
              {t('toTax')}
            </Link>
          </>
        ),
      },
      {
        key: 'vatReturn',
        title: t('rowVat', { year: String(vat.calendarYear) }),
        detail: fmt.date(vat.dueOn),
        done: false,
        blocked: false,
        canSelf: true,
        canDoNames: [],
        canDoText: '',
        href: null,
        actionLabel: '',
        doneLabel: '',
        extra: (
          <>
            {vat.overdue ? overdueBadge : null}
            {vatFile ?? toDeadlines}
          </>
        ),
      },
    ];
    return (
      <div className="flex flex-col gap-2.5" data-testid="closing-body-taxReturn">
        <RequirementList variant="rows" items={items} />
        {vatDialog}
      </div>
    );
  }
  if (period) {
    return (
      <div className="flex flex-col gap-2.5" data-testid="closing-body-taxReturn">
        <p className="flex flex-wrap items-center gap-2 text-meta text-ink-2">
          {period.overdue ? (
            <StatusBadge tone="warning" dot>
              {t('overdue')}
            </StatusBadge>
          ) : null}
          <span>{t(period.overdue ? 'dueWas' : 'due', { period: period.label, date: fmt.date(period.dueOn) })}</span>
        </p>
        {vatLine}
        <div>
          <Link href={`/finance/tax?period=${encodeURIComponent(period.id)}`} className={buttonVariants({ variant: 'outline' })} data-testid="closing-to-tax">
            {t('toTax')}
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2.5" data-testid="closing-body-taxReturn">
      <p className="text-meta text-ink-2">{t('intro', { year: status.designation })}</p>
      {vatLine}
      {vatOpen ? (
        <div className="flex flex-wrap items-center gap-3">
          {vatFile}
          {toDeadlines}
        </div>
      ) : null}
      {vatDialog}
      <ConfirmRow canConfirm={canConfirm} confirmable={step.confirmable} onConfirm={onConfirm}>
        <Link href="/finance/tax" className={buttonVariants({ variant: 'outline' })} data-testid="closing-to-tax">
          {t('toTax')}
        </Link>
      </ConfirmRow>
    </div>
  );
}
