'use client';

import type { ClosingStatus, ClosingStepView } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { formatEuro } from '@/lib/finance/amount';
import { countParts } from '@/lib/count-parts';

type TaxFacts = Extract<ClosingStepView['facts'], { key: 'taxReturn' }>;

/**
 * Der Stand der Steuererklärung des Jahres — eine Quelle für Schritt 12 und den Satz „Fertig.“ (Designer Runde 7, 294):
 * ohne Zeitraum nicht fällig; sonst Bescheid, abgegeben, Teil eines offenen Zeitraums oder fällig.
 */
export function taxReturnStateOf(f: TaxFacts | undefined): 'notDue' | 'notice' | 'filed' | 'partOf' | 'due' {
  const p = f?.period;
  if (!p) return 'notDue';
  if (p.notice) return 'notice';
  if (p.filedOn) return 'filed';
  if (!p.lastYear) return 'partOf';
  return 'due';
}

/**
 * E11 (Befund 34 a): Ist der Teil „Steuererklärung“ von Schritt 12 erledigt (abgegeben, Bescheid, Teil eines offenen
 * Zeitraums oder ohne Zeitraum bestätigt)? Dann wartet ein offener Schritt 12 nur noch auf die USt-Jahreserklärung.
 */
export function taxReturnSettled(step: Pick<ClosingStepView, 'facts' | 'confirmation'>): boolean {
  if (step.facts.key !== 'taxReturn') return false;
  return step.facts.period ? taxReturnStateOf(step.facts) !== 'due' : step.confirmation !== null;
}

/**
 * Das Ergebnis eines erledigten Schritts als Satz (Board 3a, `detail` von `Steps`), dazu die Bestätigung mit
 * Begründung als zweite Zeile „Bestätigt von <Name>: „…““. Ein offener Schritt vor dem Abschluss nennt seinen Stand
 * („4 Zuwendungen ohne Bestätigung. Sperrt nichts.“, Befund 8). `names` löst Nutzer-IDs auf (vom Server).
 */
export function useStepDetail(status: ClosingStatus, names: Readonly<Record<string, string>>): (step: ClosingStepView) => ReactNode {
  const t = useTranslations('finance.closing');
  const tr = useTranslations('finance.reports.release');
  const fmt = useDateFormat();
  const nameOf = (id: string) => names[id] ?? t('system');

  const result = (step: ClosingStepView): string | null => {
    const f = step.facts;
    switch (f.key) {
      case 'statements': {
        const filed = f.accounts.filter((a) => a.kind === 'bank' && a.statement?.covers).length;
        const serviceOk = f.accounts.filter((a) => a.kind === 'paymentService' && (a.confirmation?.kind === 'balanceConfirmed' || (!a.confirmation && a.importedBalance))).length;
        const serviceNot = f.accounts.filter((a) => a.kind === 'paymentService' && a.confirmation?.kind === 'notReconcilable').length;
        const justified = f.accounts.filter((a) => a.kind === 'bank' && !a.statement?.covers && a.confirmation?.kind === 'missingJustified');
        // Ein Konto: sein Name und der Stand (Antwort 1.3 Nr. 6); stimmen alle, die Zahl aller Konten (Designer Runde 7, 295).
        const only = f.accounts.length === 1 ? f.accounts[0]! : null;
        if (only?.kind === 'bank' && only.statement?.covers) return t('statements.resultOne', { account: only.name, date: fmt.date(only.statement.periodTo) });
        if (f.accounts.length > 1 && filed + serviceOk === f.accounts.length) return t('statements.resultAllCovered', { count: f.accounts.length, date: fmt.date(status.endsOn) });
        const parts = [
          filed > 0 ? t('statements.resultFiled', { count: filed }) : null,
          serviceOk > 0 ? t('statements.resultServiceOk', { count: serviceOk }) : null,
          serviceNot > 0 ? t('statements.resultServiceNot', { count: serviceNot }) : null,
          justified.length > 0 ? t('statements.resultJustified', { list: justified.map((a) => `${a.name} (${a.confirmation!.note ?? ''})`).join(', ') }) : null,
        ].filter(Boolean);
        return parts.length > 0 ? parts.join(', ') : t('statements.resultAll');
      }
      case 'cash':
        if (f.accounts.length === 0) return t('cash.resultNone');
        return f.accounts
          .map((a) =>
            a.count
              ? `${t('cash.result', { name: a.name, date: fmt.date(a.count.countedOn), amount: formatEuro(a.count.countedCents) })}, ${a.count.differenceCents === 0 ? t('cash.resultMatches') : t('cash.resultDiffers', { amount: formatEuro(a.count.differenceCents, { sign: 'always' }) })}.`
              : // Erledigt per Bestätigung je Kasse (Board 14a): rückgerechnet aus der späteren Zählung.
                a.confirmation && a.later
                ? t('cash.resultReckoned', { name: a.name, date: fmt.date(a.later.countedOn), amount: formatEuro(a.later.bookCentsAtEnd) })
                : null,
          )
          .filter(Boolean)
          .join(' ');
      case 'lists': {
        // Begründete Buchungen ohne Beleg zählen mit — dieselbe Quelle wie die Belegprüfung (Designer Runde 7, 295/266).
        const justified = f.undocumentedJustified > 0 ? t('lists.justified', { count: f.undocumentedJustified }) : null;
        if (f.vouchersWithoutEntry === 0 && f.foreignMoneyOpen === 0) return justified ?? t('lists.resultEmpty');
        const left = countParts([
          [f.vouchersWithoutEntry, t('lists.vouchers', { count: f.vouchersWithoutEntry })],
          [f.foreignMoneyOpen, t('lists.foreign', { count: f.foreignMoneyOpen })],
        ]);
        return [justified, t('lists.resultLeft', { parts: left })].filter(Boolean).join(' ');
      }
      case 'openItems': {
        const count = f.receivables.count + f.payables.count;
        return count === 0 ? t('openItems.resultNone') : t('openItems.result', { count });
      }
      case 'purposes':
        return f.openWithBalance === 0 && f.closedInYear === 0 ? t('purposes.resultNone') : t('purposes.result', { closed: f.closedInYear, amount: formatEuro(f.restCents) });
      case 'reserves':
        return f.reserves.length === 0 ? t('reserves.resultNone') : t('reserves.result', { count: f.reserves.length, date: fmt.date(status.endsOn) });
      case 'confirmations':
        return f.uncertified === 0 && f.toCorrect === 0 ? t('confirmations.resultNone') : t('confirmations.result', { count: f.uncertified });
      case 'close':
        return f.closedAt ? t('close.result', { date: fmt.date(f.closedAt) }) : null;
      case 'auditPackage':
        if (f.skippedBy) return t('auditPackage.skipped', { reason: tr(`bases.${f.skippedBy}.label`) });
        // Eine Form mit Tag und Stand (14d); der Kurz-Hash steht in Mono (`detail` unten).
        return f.package ? null : t('auditPackage.resultAudited');
      case 'auditReport':
        if (f.carryOver) return t('auditReport.resultCarryOver', { next: f.carryOver.targetDesignation, date: fmt.date(f.carryOver.at), note: f.carryOver.note });
        return f.filedAt ? t('auditReport.result', { date: fmt.date(f.filedAt) }) : f.release ? t('auditReport.resultReleased', { date: fmt.date(f.release.at) }) : null;
      case 'assembly': {
        const r = f.result;
        if (!r) return null;
        const date = fmt.date(r.assemblyOn);
        if (r.dischargeMode === 'collective') {
          if (r.collectiveOutcome === 'granted') return `${[t('assembly.resultCollective', { date }), r.accountsApproved === 'yes' ? t('assembly.resultApproved') : null].filter(Boolean).join(', ')}.`;
          return t('assembly.resultOpenCollective', { date, outcome: t(`assembly.outcomes.${r.collectiveOutcome ?? 'postponed'}`) });
        }
        if (r.complete) return `${[t('assembly.resultIndividual', { date, granted: r.granted, total: r.total }), r.accountsApproved === 'yes' ? t('assembly.resultApproved') : null].filter(Boolean).join(', ')}.`;
        const rest = r.discharges.filter((d) => d.outcome !== 'granted').map((d) => t('assembly.resultOpenPerson', { name: names[d.contactId] ?? '', outcome: d.outcome ? t(`assembly.outcomes.${d.outcome}`) : t('assembly.resultUndecided') }));
        return t('assembly.resultOpen', { date, granted: r.granted, total: r.total, rest: rest.join(', ') });
      }
      case 'taxReturn':
        // Mit Erklärungszeitraum steht der Satz samt Link unten (`taxReturnDetail`); ohne: „nicht fällig“, bestätigt.
        // E6a (Board Umsatzsteuer 6a): ist die USt-Jahreserklärung eingetragen, wird die Unterzeile länger.
        return f.period ? null : [t('taxReturn.result', { year: status.designation }), vatFiledResult(f)].filter(Boolean).join(' ');
      case 'fundsUse':
        return f.finalVersion ? t('fundsUse.result', { date: fmt.date(f.finalVersion.finalizedAt), number: f.finalVersion.documentNumber }) : null;
      default:
        return null;
    }
  };

  const vatFiledResult = (f: TaxFacts): string | null => (f.vat?.filedOn ? t('taxReturn.vatFiledResult', { date: fmt.date(f.vat.filedOn) }) : null);

  /**
   * Schritt 12 mit Erklärungszeitraum (Board 15h A, C, D): Teil eines offenen Zeitraums, abgegeben ohne Bescheid oder
   * mit Bescheid; der Zeitraum ist ein Link auf die Steuererklärung, der Bescheid auf sein Dokument.
   */
  const taxReturnDetail = (f: TaxFacts): ReactNode => {
    const p = f.period;
    const state = taxReturnStateOf(f);
    if (!p) return null;
    const href = `/finance/tax?period=${encodeURIComponent(p.id)}`;
    const period = (
      <Link href={href} className="text-link underline-offset-2 hover:underline" data-testid="closing-tax-period">
        {p.label}
      </Link>
    );
    if (state === 'notice' && p.notice) {
      return (
        <span className="block">
          {t.rich('taxReturn.withNotice', {
            period: () => period,
            notice: (chunks) => (
              <Link href={p.notice!.documentId ? `/dms/${encodeURIComponent(p.notice!.documentId)}` : href} className="text-link underline-offset-2 hover:underline">
                {chunks}
              </Link>
            ),
            date: fmt.date(p.notice.noticeOn),
          })}
        </span>
      );
    }
    const vatFiled = vatFiledResult(f);
    if (state === 'filed' && p.filedOn) return <span className="block">{t.rich('taxReturn.filed', { period: () => period, date: fmt.date(p.filedOn) })}{vatFiled ? ` ${vatFiled}` : null}</span>;
    if (state === 'partOf') return <span className="block">{t.rich('taxReturn.partOf', { period: () => period, last: p.last })}{vatFiled ? ` ${vatFiled}` : null}</span>;
    return null;
  };

  /**
   * Der Stand eines offenen Schritts vor dem Abschluss, aus den Fakten — nur der Stand, ohne Vorsatz und ohne Auftrag
   * (284): Was zu tun ist, sagt erst der aktive Schritt. Vor dem Jahresende ohne Stichtag, danach mit.
   */
  const openState = (step: ClosingStepView): string | null => {
    const f = step.facts;
    switch (f.key) {
      case 'statements': {
        const parts = [f.accountsWithoutImport > 0 ? t('statements.withoutImport', { count: f.accountsWithoutImport }) : null, f.openTransactions > 0 ? t('statements.openTransactions', { count: f.openTransactions }) : null].filter(Boolean);
        return parts.length > 0 ? t('statements.openImports', { parts: parts.join(' · ') }) : t('statements.openReady');
      }
      case 'cash':
        if (f.accounts.length === 0) return t('cash.resultNone');
        return f.accounts
          .map((a) =>
            a.count
              ? t('cash.openCounted', { name: a.name, date: fmt.date(a.count.countedOn), amount: formatEuro(a.count.countedCents) })
              : a.later
                ? t('cash.openLater', { name: a.name, date: fmt.date(a.later.countedOn) })
                : t('cash.openNotCounted', { name: a.name }),
          )
          .join(' ');
      case 'lists': {
        if (f.undocumentedUnjustified + f.drafts + f.vouchersWithoutEntry + f.foreignMoneyOpen === 0) return t('lists.resultEmpty');
        const parts = countParts([
          [f.undocumentedUnjustified, t('lists.undocumented', { count: f.undocumentedUnjustified })],
          [f.drafts, t('lists.drafts', { count: f.drafts })],
          [f.vouchersWithoutEntry, t('lists.vouchers', { count: f.vouchersWithoutEntry })],
          [f.foreignMoneyOpen, t('lists.foreign', { count: f.foreignMoneyOpen })],
        ]);
        return t('lists.openLeft', { parts });
      }
      case 'openItems': {
        const count = f.receivables.count + f.payables.count;
        if (count === 0) return t('openItems.resultNone');
        return status.ended ? t('openItems.openState', { count, date: fmt.date(status.endsOn) }) : t('openItems.openStateNow', { count });
      }
      case 'purposes':
        if (f.negative > 0) return t('purposes.negative', { count: f.negative });
        return f.openWithBalance === 0 ? t('purposes.resultNone') : t('purposes.openState', { count: f.openWithBalance, amount: formatEuro(f.restCents) });
      case 'reserves':
        if (f.reserves.length === 0) return t('reserves.resultNone');
        return status.ended ? t('reserves.openState', { count: f.reserves.length, date: fmt.date(status.endsOn) }) : t('reserves.openStateNow', { count: f.reserves.length });
      case 'confirmations':
        if (f.uncertified === 0 && f.toCorrect === 0) return t('confirmations.resultNone');
        return f.uncertified > 0 ? t('confirmations.result', { count: f.uncertified }) : t('confirmations.summary', { uncertified: f.uncertified, toCorrect: f.toCorrect });
      default:
        return null;
    }
  };

  return (step) => {
    if (!step.done && step.group === 'before') return openState(step);
    const sentence = result(step);
    const c = step.confirmation;
    const confirmedLine = (x: NonNullable<typeof c>) => (x.note ? t('confirmedBy', { name: nameOf(x.byUserId), note: x.note }) : t('confirmedByNoNote', { name: nameOf(x.byUserId), date: fmt.date(x.at) }));
    // Schritt 2 bestätigt man je Kasse (Board 14a): je bestätigter Kasse eine Zeile „Bestätigt von …: „…““.
    const confirmed =
      step.facts.key === 'cash'
        ? step.facts.accounts.flatMap((a) => (a.confirmation ? [confirmedLine(a.confirmation)] : [])).join(' ') || null
        : c && step.key !== 'statements'
          ? confirmedLine(c)
          : null;
    if (step.facts.key === 'auditPackage' && !step.facts.skippedBy && step.facts.package) {
      return (
        <span className="block">
          {t('auditPackage.result', { date: fmt.date(step.facts.package.at) })} <span className="font-mono">{step.facts.package.shortHash}</span>
        </span>
      );
    }
    if (step.facts.key === 'taxReturn' && step.facts.period) return taxReturnDetail(step.facts);
    if (!sentence && !confirmed) return null;
    return (
      <>
        {sentence ? (
          <span className="block">
            {sentence}
            {step.facts.key === 'assembly' && step.facts.result?.minutesDocumentId ? (
              <>
                {' '}
                <Link href={`/dms/${encodeURIComponent(step.facts.result.minutesDocumentId)}`} className="text-link underline-offset-2 hover:underline">
                  {t('assembly.minutesLink')}
                </Link>
              </>
            ) : null}
          </span>
        ) : null}
        {confirmed ? (
          <span className="block" data-testid={`closing-confirmed-${step.key}`}>
            {confirmed}
          </span>
        ) : null}
      </>
    );
  };
}
