'use client';

import type { HandoverView as Handover } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useDateFormat } from '@/components/date-format-provider';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { PageHeader } from '@/components/page-header';
import { panelHref } from '@/components/panel-nav';
import { RecordActions } from '@/components/record-actions';
import { Section } from '@/components/section';
import { Steps, type Step } from '@/components/steps';
import { Button } from '@/components/ui/button';
import { formatEuro } from '@/lib/finance/amount';
import { reportQuery } from '@/lib/finance/report-params';
import { CountDialog } from '../../cash/count-dialog';
import { HandoverStartDialog } from '../handover-start-dialog';
import { cancelHandoverAction, interimReportAction } from './actions';
import { HandoverItems } from './handover-items';

const link = 'text-link underline-offset-2 hover:underline';

/**
 * Amtsübergabe (Board 13e, korrigiert 14c): Kopf mit Satz „Von … an … am …. n von 3 erledigt.“, ⋯ „Angaben ändern …“
 * (bis der Zwischenbericht steht) und „Abbrechen …“; drei Schritte wie im Jahresabschluss — Karte, Ergebnis als
 * Unterzeile, offene Schritte mit Satz; darunter „Daran denken“ ohne Sperre. Schritt 2 zählt jede Kasse mit Bestand
 * am Übergabetag, mit Abgleich gegen den Buchbestand. Alles erledigt: „Fertig.“ unter dem Kopf, die Schritte zugeklappt.
 */
export function HandoverView({
  handover: h,
  year,
  back,
  canManage,
  canCount = canManage,
  canCreateContact,
}: {
  handover: Handover;
  year: { id: string; designation: string; startsOn: string };
  back: { href: string; label: string };
  canManage: boolean;
  /** Zählen braucht zusätzlich `finance.entriesFinalize` (der Dienst zählt über `countCash`, Schlussdurchsicht I4). */
  canCount?: boolean;
  canCreateContact: boolean;
}) {
  const t = useTranslations('finance.closing.handover');
  const fmt = useDateFormat();
  const router = useRouter();
  const more = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [pending, setPending] = useState(false);
  const interim = useActionFeedback();
  const open = h.state === 'open';
  const date = fmt.date(h.handoverOn);

  const createInterim = async () => {
    setPending(true);
    const result = await interim.run(() => interimReportAction(h.id), { retry: () => void createInterim() });
    setPending(false);
    if (result.status === 'success') router.refresh();
  };

  const cashOk = h.cashAccounts.every((a) => a.count !== null && a.count.differenceCents === 0);
  const done = { interim: h.interimReport !== null, cash: cashOk, protocol: h.protocolDocumentId !== null };
  const activeKey = !open ? null : !done.interim ? 'interim' : !done.cash ? 'cash' : !done.protocol ? 'protocol' : null;
  const reportHref = `/finance/reports/cashReport?${reportQuery({ fiscalYearId: h.fiscalYearId, date: h.handoverOn })}`;

  const cashLine = (a: Handover['cashAccounts'][number]) =>
    !a.count
      ? t('cash.notCounted', { name: a.name, amount: formatEuro(a.bookCents) })
      : a.count.differenceCents === 0
        ? t('cash.matches', { name: a.name, amount: formatEuro(a.count.countedCents) })
        : t('cash.differs', { name: a.name, amount: formatEuro(a.count.countedCents), difference: formatEuro(a.count.differenceCents, { sign: 'always' }) });
  const steps: Step[] = [
    {
      key: 'interim',
      label: t('steps.interim'),
      state: done.interim ? 'done' : activeKey === 'interim' ? 'active' : 'todo',
      detail: h.interimReport ? (
        <>
          <Link href={reportHref} className={link} data-testid="handover-interim-link">
            {t('interim.link', { from: fmt.date(year.startsOn), to: date })}
          </Link>
          {', '}
          {t('interim.stamp')} <span className="font-mono">{h.interimReport.shortHash}</span>
        </>
      ) : undefined,
      below:
        activeKey === 'interim' ? (
          <div className="flex flex-col gap-2.5">
            <p className="text-meta text-ink-2">{t('interim.intro')}</p>
            {canManage ? (
              <div>
                <Button type="button" onClick={() => void createInterim()} disabled={pending} data-testid="handover-interim">
                  {t('interim.create')}
                </Button>
              </div>
            ) : null}
            <RefusalNotice action state={interim.state} />
          </div>
        ) : undefined,
    },
    {
      key: 'cash',
      label: t('steps.cash'),
      state: done.cash ? 'done' : activeKey === 'cash' ? 'active' : 'todo',
      // Je Kasse eine Zeile mit Abgleich (14c); offen vor dem aktiven Schritt der Satz, was zu tun ist.
      detail: !h.cashRequired ? t('cash.noCash') : done.cash ? <CashLines handover={h} /> : activeKey === 'cash' ? undefined : t('cash.open'),
      below:
        activeKey === 'cash' ? (
          <div className="flex flex-col gap-2.5">
            <p className="text-meta text-ink-2">{t('cash.intro', { from: h.fromName, to: h.toName })}</p>
            <ul className="flex flex-col" data-testid="handover-cash">
              {h.cashAccounts.map((a) => (
                <li key={a.accountId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-t border-line-2 py-2" data-testid="handover-cash-row">
                  <span className="min-w-0 text-body text-ink-2">{cashLine(a)}</span>
                  {canCount && !(a.count && a.count.differenceCents === 0) ? (
                    <CountDialog
                      key={a.accountId}
                      account={{ id: a.accountId, name: a.name, bookCents: a.bookCents }}
                      today={h.handoverOn}
                      canCreateContact={canCreateContact}
                      handover={{ id: h.id, handoverOn: h.handoverOn, from: { id: h.fromContactId, name: h.fromName }, to: { id: h.toContactId, name: h.toName }, triggerLabel: t('cash.countBox', { name: a.name }), primary: h.cashAccounts.length === 1 }}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
            {!canCount && canManage ? <p className="text-meta text-muted-ink">{t('cash.noRight')}</p> : null}
          </div>
        ) : undefined,
    },
    {
      key: 'protocol',
      label: t('steps.protocol'),
      state: done.protocol ? 'done' : activeKey === 'protocol' ? 'active' : 'todo',
      detail: done.protocol ? (
        <Link href={`/dms/${encodeURIComponent(h.protocolDocumentId!)}`} className={link} data-testid="handover-protocol-link">
          {t('protocol.done', { date })}
        </Link>
      ) : activeKey === 'protocol' ? undefined : t('protocol.intro'),
      below: activeKey === 'protocol' ? <HandoverItems handover={h} canManage={canManage} /> : undefined,
    },
  ];

  // Die Kassen einzeln, nicht addiert (Designer Runde 7, 301): „Barkasse 85,00 €, Zählkasse 200,00 €“.
  const cashText = h.cashAccounts.length > 0 ? t('finishedCash', { list: h.cashAccounts.map((a) => t('finishedCashOne', { name: a.name, amount: formatEuro(a.count?.countedCents ?? 0) })).join(', ') }) : '';
  const headSentence = h.state === 'cancelled' ? t('cancelled', { from: h.fromName, to: h.toName, date }) : t('head', { from: h.fromName, to: h.toName, date, done: Object.values(done).filter(Boolean).length, total: 3 });

  return (
    <>
      <PageHeader
        back={back}
        title={t('title')}
        description={<span data-testid="handover-head">{headSentence}</span>}
        actions={
          canManage && open ? (
            <RecordActions
              triggerRef={more}
              testId="handover-more"
              actions={[
                { key: 'edit', label: t('more.edit'), kind: 'reversible', onSelect: () => setEditing(true), hidden: h.interimReport !== null, testId: 'handover-edit' },
                { key: 'cancel', label: t('more.cancel'), kind: 'undoing', onSelect: () => setCancelling(true), testId: 'handover-cancel' },
              ]}
            />
          ) : null
        }
      />
      <div className="flex flex-col gap-6">
        {/* Wie der Jahresabschluss in der Karte, aber ohne Overline: der Seitentitel sagt schon, worum es geht (Runde 6). */}
        <Steps density="compact" steps={steps} card label={t('stepsLabel')} done={t('finished', { date, cash: cashText })} collapsedWhenDone={{ label: t('showSteps') }} testId="handover-steps" />
        {h.state !== 'cancelled' ? (
          <Section title={t('remember.title')}>
            <div className="flex flex-col gap-2 text-meta text-ink-2" data-testid="handover-remember">
              {h.statutoryBoard !== false ? (
                <p data-testid="handover-register">
                  {t('remember.register')}{' '}
                  <Link href={panelHref('/admin/finance', 'reports')} className={link}>
                    {t('remember.statute')}
                  </Link>
                </p>
              ) : null}
              <p>{t('remember.discharge', { from: h.fromName, date })}</p>
            </div>
          </Section>
        ) : null}
      </div>
      {canManage && open && h.interimReport === null ? (
        <HandoverStartDialog open={editing} onOpenChange={setEditing} today={h.handoverOn} canCreateContact={canCreateContact} edit={{ id: h.id, handoverOn: h.handoverOn, from: { id: h.fromContactId, name: h.fromName }, to: { id: h.toContactId, name: h.toName }, version: h.version }} finalFocus={more} />
      ) : null}
      {canManage && open ? (
        <ConfirmDialog
          open={cancelling}
          onOpenChange={setCancelling}
          title={t('cancelDialog.title')}
          description={t('cancelDialog.description')}
          confirmLabel={t('cancelDialog.confirm')}
          finalFocus={more}
          action={async () => {
            const result = await cancelHandoverAction(h.id);
            if (result.status === 'success') {
              toast.success(t('cancelDialog.done'));
              router.refresh();
            }
            return result;
          }}
        />
      ) : null}
    </>
  );
}

/** Schritt 2 erledigt (14c): je Kasse „Barkasse: 85,00 €, stimmt mit dem Buchbestand.“, eine Zeile je Kasse. */
function CashLines({ handover: h }: { handover: Handover }) {
  const tc = useTranslations('finance.closing.handover.cash');
  return (
    <>
      {h.cashAccounts.map((a) => (
        <span key={a.accountId} className="block">
          {tc('matches', { name: a.name, amount: formatEuro(a.count?.countedCents ?? 0) })}
        </span>
      ))}
    </>
  );
}
