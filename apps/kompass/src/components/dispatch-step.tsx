'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { pollTextStatus } from '@/lib/poll-text-status';
import { toast } from 'sonner';
import { useDateFormat } from '@/components/date-format-provider';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Notice } from '@/components/notice';
import { RowMenu } from '@/components/row-menu';
import { SectionHeading } from '@/components/section';
import { StatusBadge, statusTone } from '@/components/status-badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { ActionState } from '@/lib/actions';

type MailRowState = 'notQueued' | 'queued' | 'sending' | 'sent' | 'failed' | 'blocked' | 'withdrawn';

interface DispatchRowBase {
  documentId: string;
  documentNumber: string | null;
  /** Empfänger (Name, ohne Adresse im Protokoll). */
  name: string;
  /** Was der Brief ist: Mahnstufe, „Beitragsmitteilung“, Art der Bestätigung. */
  detail: string | null;
  /** Versandvermerk am Dokument (Tag). */
  sentAt: string | null;
}
export interface DispatchMailRow extends DispatchRowBase {
  address: string;
  state: MailRowState;
  outboxId: string | null;
  errorText: string | null;
  errorCode: string | null;
}
export interface DispatchPostRow extends DispatchRowBase {
  /** Schlüssel unter `dispatchStep.reason`. */
  reason: string;
  dispatched: boolean;
}

/**
 * Der Schritt „Versand“ der Läufe (Handoff Mitglieder Phase 2b E3): Gruppe „Per E-Mail · n“ mit „{n} per E-Mail senden“
 * und je Zeile dem Zustand im Ausgang, Gruppe „Per Post · m“ mit „Als PDF zum Drucken“ und je Zeile „Versand vermerken
 * …“. Fertig ist der Lauf, wenn jede Zeile gesendet oder vermerkt ist; bis dahin nennt ein Hinweis die Zeilen, die nicht
 * hinausgingen, mit dem Ausweg „Per Post schicken“. Gemeinsam für Beitrags-, Mahn- und Serienlauf; die Dienste kommen
 * als Funktionen vom Aufrufer.
 *
 * Nachtrag MCP-Test § 2 (Plan U4 Task 2): Eine Zeile der Mail-Gruppe, die wartet oder nicht zugestellt ist, wandert über
 * ihr Zeilenmenü „Per Post schicken“ in die Post-Gruppe (Grund „von Hand verschoben“); dort steht „Zurück zu E-Mail“,
 * solange sie nicht vermerkt ist. Vermerkt wird nur in der Post-Gruppe.
 */
export function DispatchStep({
  mail,
  post,
  done,
  mailState,
  canSend,
  canMark,
  today,
  printHref,
  documentHref,
  onSendAll,
  onMark,
  onResend,
  onMove,
  countLabel,
  runRef,
}: {
  /** Der Lauf im Ausgang (`membersFeeRun:…`, `financeConfirmationRun:…`): Solange eine Mail wartet oder gesendet wird,
   *  fragt der Schritt über `/dms/run-mail-status` nach und erneuert die Seite, wenn nichts mehr läuft. */
  runRef: string;
  /** Zähler im Kopf der Gruppen („2 Briefe“); der Serienlauf zählt Bestätigungen (20c). */
  countLabel?: (count: number) => string;
  mail: DispatchMailRow[];
  post: DispatchPostRow[];
  done: boolean;
  mailState: { kind: 'off' | 'ready' | 'redirect' | 'blocked'; redirectTo: string | null };
  canSend: boolean;
  canMark: boolean;
  today: string;
  /** Ein PDF mit allen Briefen der Post-Gruppe. */
  printHref: string;
  documentHref: (documentId: string) => string;
  onSendAll: () => Promise<ActionState>;
  onMark: (documentIds: string[], sentAt: string) => Promise<ActionState>;
  onResend: (outboxId: string) => Promise<ActionState>;
  /** „Per Post schicken“ (`post`) bzw. „Zurück zu E-Mail“ (`email`) für Briefe des Laufs. */
  onMove: (documentIds: string[], to: 'post' | 'email') => Promise<ActionState>;
}) {
  const t = useTranslations('dispatchStep');
  const { date } = useDateFormat();
  const router = useRouter();
  const feedback = useActionFeedback();
  const [busy, setBusy] = useState(false);
  const [marking, setMarking] = useState<string[] | null>(null);

  const run = async (fn: () => Promise<ActionState>) => {
    setBusy(true);
    // Die Meldung der Aktion sagt `run` selbst an; ein zweiter Toast hier verdoppelte sie.
    const result = await feedback.run(fn);
    setBusy(false);
    if (result.status !== 'success') return;
    router.refresh();
  };

  const unsent = mail.filter((m) => m.state === 'notQueued');
  const running = mail.some((m) => m.state === 'queued' || m.state === 'sending');
  useEffect(() => {
    if (!running) return;
    return pollTextStatus({
      url: `/dms/run-mail-status?runRef=${encodeURIComponent(runRef)}`,
      isPending: (body) => body.pending === true,
      onDone: () => router.refresh(),
      onUnauthorized: () => router.refresh(),
    });
  }, [running, runRef, router]);
  const counted = (count: number) => (countLabel ? countLabel(count) : t('count', { count }));
  // Was nicht hinausging (nicht zugestellt, gesperrt) und noch keinen Vermerk trägt: Ausweg „Per Post schicken“.
  const stuck = mail.filter((m) => (m.state === 'failed' || m.state === 'blocked') && m.outboxId && !m.sentAt);
  // „Per Post schicken“ je Zeile: wartet (noch nicht eingereiht oder im Ausgang), gesperrt oder nicht zugestellt.
  const movable = (m: DispatchMailRow) => canMark && !m.sentAt && (m.state === 'notQueued' || m.state === 'queued' || m.state === 'blocked' || m.state === 'failed');
  const mailDetail = (m: DispatchMailRow) =>
    m.state === 'failed' && m.errorText ? `${m.errorText}${m.errorCode ? ` (${m.errorCode})` : ''}` : m.state === 'sent' && m.sentAt ? date(m.sentAt) : m.address;

  return (
    <div className="space-y-4" data-testid="dispatch-step">
      {mailState.kind === 'redirect' && mailState.redirectTo ? <Notice level="warn">{t('redirect', { to: mailState.redirectTo })}</Notice> : null}
      {mailState.kind === 'blocked' ? <Notice level="warn">{t('blocked')}</Notice> : null}
      <RefusalNotice action state={feedback.state} />

      {mail.length > 0 ? (
        <section data-testid="dispatch-mail" aria-labelledby="dispatch-mail-heading" className="rounded-md border border-line bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3 pb-2">
            <SectionHeading id="dispatch-mail-heading">
              <StatusBadge tone="neutral">{t('mailGroup')}</StatusBadge> · {counted(mail.length)}
            </SectionHeading>
            {canSend && unsent.length > 0 ? (
              <Button type="button" size="sm" disabled={busy} onClick={() => void run(onSendAll)} data-testid="dispatch-send-all">
                {t('sendAll', { count: unsent.length })}
              </Button>
            ) : null}
          </div>
          <ul className="divide-y divide-line-2 border-t border-line-2 text-meta">
            {mail.map((m) => (
              <li key={m.documentId} data-testid="dispatch-mail-row" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2">
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="font-semibold text-ink">{m.name}</span>
                  <span className="text-ink-2">
                    <Link href={documentHref(m.documentId)} className="text-link underline-offset-2 hover:underline">{m.documentNumber ?? m.documentId}</Link>
                    {[m.detail, mailDetail(m)].filter(Boolean).map((part) => ` · ${part}`).join('')}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-3">
                  {m.state === 'notQueued' ? null : <StatusBadge tone={statusTone('outbox', m.state)} dot>{t(`state.${m.state}`)}</StatusBadge>}
                  {canSend && m.state === 'failed' && m.outboxId ? (
                    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void run(() => onResend(m.outboxId!))}>{t('resend')}</Button>
                  ) : null}
                  {movable(m) ? <RowMenu name={m.name} items={[{ key: 'toPost', label: t('toPost'), onSelect: () => void run(() => onMove([m.documentId], 'post')), testId: 'dispatch-to-post' }]} /> : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {post.length > 0 ? (
        <section data-testid="dispatch-post" aria-labelledby="dispatch-post-heading" className="rounded-md border border-line bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3 pb-2">
            <SectionHeading id="dispatch-post-heading">
              <StatusBadge tone="neutral">{t('postGroup')}</StatusBadge> · {counted(post.length)}
            </SectionHeading>
            <a href={printHref} className={buttonVariants({ variant: 'outline', size: 'sm' })} data-testid="dispatch-print">{t('print')}</a>
          </div>
          <ul className="divide-y divide-line-2 border-t border-line-2 text-meta">
            {post.map((p) => (
              <li key={p.documentId} data-testid="dispatch-post-row" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2">
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="font-semibold text-ink">{p.name}</span>
                  <span className="text-ink-2">
                    <Link href={documentHref(p.documentId)} className="text-link underline-offset-2 hover:underline">{p.documentNumber ?? p.documentId}</Link>
                    {[p.detail, p.dispatched && p.sentAt ? t('sentOn', { date: date(p.sentAt) }) : t(`reason.${p.reason}`)].filter(Boolean).map((part) => ` · ${part}`).join('')}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-3">
                  {p.dispatched ? (
                    <StatusBadge tone={statusTone('outbox', 'sent')} dot>{t('dispatched')}</StatusBadge>
                  ) : canMark ? (
                    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setMarking([p.documentId])} data-testid="dispatch-mark">{t('markSent')}</Button>
                  ) : null}
                  {canMark && p.reason === 'manual' && !p.dispatched ? <RowMenu name={p.name} items={[{ key: 'toEmail', label: t('toEmail'), onSelect: () => void run(() => onMove([p.documentId], 'email')), testId: 'dispatch-to-email' }]} /> : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Fertig sagt der Schrittbalken darüber („Fertig.“, MUSTER § B); hier nur, was noch offen ist. */}
      {!done && stuck.length > 0 ? (
        <Notice
          level="warn"
          title={t('openTitle')}
          action={canMark ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void run(() => onMove(stuck.map((m) => m.documentId), 'post'))}>{t(stuck.length > 1 ? 'toPostAll' : 'toPost')}</Button> : undefined}
        >
          {t('openText', { names: stuck.map((m) => m.name).join(', ') })}
        </Notice>
      ) : null}

      {marking ? <MarkDialog today={today} onClose={() => setMarking(null)} onSubmit={(sentAt) => onMark(marking, sentAt)} /> : null}
    </div>
  );
}

function MarkDialog({ today, onClose, onSubmit }: { today: string; onClose: () => void; onSubmit: (sentAt: string) => Promise<ActionState> }) {
  const t = useTranslations('dispatchStep');
  const router = useRouter();
  const [sentAt, setSentAt] = useState(today);
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const submit = async () => {
    setPending(true);
    const result = await feedback.run(() => onSubmit(sentAt), { retry: () => void submit() });
    setPending(false);
    if (result.status !== 'success') return;
    toast.success(t('markDone'));
    onClose();
    router.refresh();
  };
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t('markTitle')}</DialogTitle>
          <DialogDescription>{t('markText')}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <FormGrid>
            <FormField id="dispatch-mark-date" label={t('markDate')} required size="s">
              <Input id="dispatch-mark-date" type="date" value={sentAt} max={today} onChange={(e) => setSentAt(e.target.value)} />
            </FormField>
          </FormGrid>
        </DialogBody>
        <FormActionBar placement="dialog" cancel={onClose} pending={pending} saveDisabled={!sentAt} saveLabel={t('markSubmit')} onSave={() => void submit()} state={feedback.state} testId="dispatch-mark-footer" />
      </DialogContent>
    </Dialog>
  );
}
