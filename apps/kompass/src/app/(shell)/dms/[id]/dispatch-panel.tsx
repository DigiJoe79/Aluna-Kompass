'use client';

import { useDateFormat } from '@/components/date-format-provider';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState, useTransition } from 'react';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { idleState } from '@/lib/actions';
import { clearDispatchAction, recordDispatchAction } from '../actions';
import { ActionForm } from '@/components/forms/action-form';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { Section } from '@/components/section';
import type { DocumentMailDraft, OutboxListItem } from '@kompass/module-dms';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { StatusBadge, statusTone } from '@/components/status-badge';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { pollTextStatus } from '@/lib/poll-text-status';
import { resendDocumentMailAction } from '../actions';
import { MailSendDialog } from './mail-send-dialog';
import { panelHref } from '@/components/panel-nav';
import { mailFailureReason } from '../mail-failure-reason';

/**
 * Der Versandvermerk steht neben dem Dokument, nicht darin: Er ändert nichts
 * am festgeschriebenen Blatt und darf deshalb nachgetragen und berichtigt
 * werden — was, wann und durch wen, hält das Protokoll fest.
 *
 * Dazu „Per E-Mail senden …“ (Handoff 2b E2, 19a): Ungesendet nennt die Karte den Zustellweg, die Knöpfe stehen in
 * dessen Reihenfolge. Sendungen stehen untereinander, die neueste oben; Marken nur, solange etwas offen ist (wartet,
 * wird gesendet, nicht zugestellt, gesperrt), eine gesendete Mail steht als Vermerk. Solange eine Sendung unterwegs
 * ist, fragt die Karte über einen Route Handler nach und erneuert die Seite, wenn sie draußen oder abgelehnt ist.
 */
export function DispatchPanel({
  documentId,
  sentAt,
  sentVia,
  sentNote,
  channels,
  today,
  canEdit,
  mail = null,
  canSend = false,
  userNames = {},
}: {
  /** Was „Per E-Mail senden“ braucht; `null`, wenn der Brief nicht per E-Mail hinaus kann (kein Recht, keine Akte). */
  mail?: DocumentMailDraft | null;
  canSend?: boolean;
  /** Namen der Auslösenden (Nutzer-ID → Name). */
  userNames?: Record<string, string>;
  documentId: string;
  sentAt: string | null;
  sentVia: string | null;
  sentNote: string | null;
  channels: { key: string; label: string }[];
  today: string;
  canEdit: boolean;
}) {
  const t = useTranslations('dms.dispatch');
  const fmt = useDateFormat();
  const [open, setOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  // Kontrolliert, nicht `defaultValue`: Base UI warnt, wenn sich der Vorgabewert
  // eines unkontrollierten Feldes nach dem Aufbau ändert — und `sentAt` ändert
  // sich mit jedem Vermerk (Befund 7, 2026-09-12).
  const [sentAtValue, setSentAtValue] = useState(sentAt ?? today);
  const [sentViaValue, setSentViaValue] = useState(sentVia ?? channels[0]?.key ?? '');
  const [noteValue, setNoteValue] = useState(sentNote ?? '');
  useEffect(() => {
    if (!open) return;
    setSentAtValue(sentAt ?? today);
    setSentViaValue(sentVia ?? channels[0]?.key ?? '');
    setNoteValue(sentNote ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const [state, action] = useActionState(recordDispatchAction.bind(null, documentId), idleState);
  const errors = state.status === 'error' ? state.fieldErrors : {};

  useEffect(() => {
    if (state.status === 'success') setOpen(false);
  }, [state]);

  const channelLabel = sentVia ? (channels.find((c) => c.key === sentVia)?.label ?? sentVia) : null;

  const ts = useTranslations('dms.send');
  const tState = useTranslations('dispatchStep.state');
  const tCode = useTranslations('dms.mailErrorCodes');
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [resending, setResending] = useState<OutboxListItem | null>(null);
  const resendFb = useActionFeedback();
  const sendings = mail?.sendings ?? [];
  const latest = sendings[0] ?? null;
  const unterwegs = sendings.some((s) => s.status === 'queued' || s.status === 'sending');
  // Eine Mail, die draußen ist, trägt den Vermerk selbst; der Vermerk von Hand steht wie bisher.
  const mailedVermerk = sentAt !== null && sentVia === 'email' && sendings.some((s) => s.status === 'sent');
  const firstRecipient = mail?.recipients[0] ?? null;
  const byMail = firstRecipient?.channel === 'email';
  const showSendButtons = !sentAt && !sendings.some((s) => s.status === 'queued' || s.status === 'sending' || s.status === 'sent' || s.status === 'failed');

  useEffect(() => {
    if (!unterwegs) return;
    return pollTextStatus({
      url: `/dms/${encodeURIComponent(documentId)}/mail-status`,
      isPending: (body) => body.pending === true,
      onDone: () => router.refresh(),
      onUnauthorized: () => router.refresh(),
    });
  }, [unterwegs, documentId, router]);

  const resend = async (entry: OutboxListItem) => {
    const result = await resendFb.run(() => resendDocumentMailAction(documentId, entry.id), { retry: () => void resend(entry) });
    if (result.status !== 'success') return;
    setResending(null);
    router.refresh();
  };

  const mailButton = canSend && mail ? (
    <Button key="mail" type="button" variant="outline" size="sm" onClick={() => setSending(true)} data-testid="dispatch-send-mail">
      {ts('mail')}
    </Button>
  ) : null;
  const markButton = canEdit ? (
    <Button key="mark" type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
      {t('markButton')}
    </Button>
  ) : null;

  return (
    <section data-testid="dispatch-panel" className="rounded-md border border-line bg-surface p-5 shadow-xs">
      <Section title={t('title')}>
        <RefusalNotice action state={resendFb.state} />
        {sendings.length > 0 ? (
          <ul className="mb-3 divide-y divide-line-2" data-testid="dispatch-sendings">
            {sendings.map((entry) => (
              <li key={entry.id} data-testid="dispatch-sending" data-status={entry.status} className="space-y-2 py-2.5 text-meta first:pt-0">
                {entry.status === 'sent' ? (
                  <dl className="space-y-2">
                    <div>
                      <dt className="text-muted-ink">{ts('sentAt')}</dt>
                      <dd className="text-ink">{entry.sentAt ? fmt.dateTime(entry.sentAt) : null}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-ink">{ts('way')}</dt>
                      <dd className="text-ink">{ts('wayMail', { address: entry.toAddress ?? '' })}</dd>
                    </div>
                    {entry.queuedByUserId && userNames[entry.queuedByUserId] ? (
                      <div>
                        <dt className="text-muted-ink">{ts('triggeredBy')}</dt>
                        <dd className="text-ink">{userNames[entry.queuedByUserId]}</dd>
                      </div>
                    ) : null}
                  </dl>
                ) : (
                  <>
                    <StatusBadge tone={statusTone('outbox', entry.status)} dot>{tState(entry.status)}</StatusBadge>
                    <dl className="space-y-2">
                      <div>
                        <dt className="text-muted-ink">{ts('mailTo')}</dt>
                        <dd className="text-ink">{[entry.contactName, entry.toAddress].filter(Boolean).join(' · ')}</dd>
                      </div>
                      {entry.status === 'failed' ? (
                        <div>
                          <dt className="text-muted-ink">{ts('reason')}</dt>
                          <dd className="text-ink">{mailFailureReason(tCode, entry.lastErrorCode, entry.lastErrorText)}</dd>
                        </div>
                      ) : (
                        <div>
                          <dt className="text-muted-ink">{ts('triggered')}</dt>
                          <dd className="text-ink">{[fmt.dateTime(entry.queuedAt), entry.queuedByUserId ? userNames[entry.queuedByUserId] : null].filter(Boolean).join(' · ')}</dd>
                        </div>
                      )}
                    </dl>
                    {entry.status === 'queued' || entry.status === 'sending' ? <p className="text-muted-ink">{ts('pendingNote')}</p> : null}
                  </>
                )}
                {entry === latest && canSend && entry.status === 'sent' ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => setResending(entry)} data-testid="dispatch-resend">{ts('resendMore')}</Button>
                ) : null}
                {entry === latest && entry.status === 'blocked' ? (
                  // Gesperrt (Testumgebung ohne Umleitung): zu tun ist etwas an der Einrichtung, nicht am Brief (Handoff 2b § 1).
                  <div className="flex flex-col items-start gap-2">
                    <p className="text-muted-ink">{ts('blocked')}</p>
                    <div className="flex flex-wrap gap-2">{markButton}</div>
                    <Link href={panelHref('/admin/dms', 'channels')} className="text-meta font-semibold text-ink underline-offset-2 hover:underline">{ts('toSettings')}</Link>
                  </div>
                ) : null}
                {entry === latest && entry.status === 'failed' ? (
                  <div className="flex flex-col items-start gap-2">
                    <div className="flex flex-wrap gap-2">
                      {canSend ? <Button type="button" variant="outline" size="sm" disabled={resendFb.pending} aria-busy={resendFb.pending || undefined} onClick={() => void resend(entry)} data-testid="dispatch-resend">{ts('resend')}</Button> : null}
                      {markButton}
                    </div>
                    <Link href={`/contacts/${entry.contactId}`} className="text-meta font-semibold text-ink underline-offset-2 hover:underline">{ts('fixAddress')}</Link>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {mailedVermerk ? null : sentAt ? (
          <dl className="space-y-2 text-meta">
            <div>
              <dt className="text-muted-ink">{t('sentAt')}</dt>
              <dd className="text-ink">{fmt.date(sentAt)}</dd>
            </div>
            <div>
              <dt className="text-muted-ink">{t('sentVia')}</dt>
              <dd className="text-ink">{channelLabel}</dd>
            </div>
            {sentNote ? (
              <div>
                <dt className="text-muted-ink">{t('note')}</dt>
                <dd className="text-ink-2">{sentNote}</dd>
              </div>
            ) : null}
          </dl>
        ) : sendings.length > 0 ? null : (
          <p className="text-meta text-muted-ink">
            {firstRecipient?.name ? (byMail ? ts('notSent', { name: firstRecipient.name }) : ts('notSentPost', { name: firstRecipient.name })) : t('none')}
          </p>
        )}

        {showSendButtons && (mailButton || markButton) ? (
          // Beide `outline`, Reihenfolge nach Zustellweg: bei „per Post“ steht „Versand vermerken …“ vorn (19a).
          <div className="mt-4 flex flex-wrap gap-2">{byMail ? [mailButton, markButton] : [markButton, mailButton]}</div>
        ) : null}
        {canEdit && sentAt && !mailedVermerk ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
              {t('change')}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setClearing(true)}>
              {t('clear')}
            </Button>
          </div>
        ) : null}

        {mail ? <MailSendDialog open={sending} onOpenChange={setSending} documentId={documentId} draft={mail} onRecordDispatch={() => setOpen(true)} /> : null}
        <ConfirmDialog
          open={resending !== null}
          onOpenChange={(next) => (next ? undefined : setResending(null))}
          title={ts('resend')}
          description={ts('resendText', { address: resending?.toAddress ?? '' })}
          confirmLabel={ts('resend')}
          action={async () => {
            const result = await resendDocumentMailAction(documentId, resending!.id);
            if (result.status === 'success') toast.success(ts('sending'));
            return result;
          }}
        />

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent size="md" className="bg-surface shadow-md">
            <ActionForm action={action} state={state}>
              <DialogTitle>{t('record')}</DialogTitle>
              <DialogDescription>{t('description')}</DialogDescription>

              <div className="mt-5">
                <FormGrid>
                  <FormField id="sentAt" label={t('sentAt')} required error={errors.sentAt} size="s">
                    <Input id="sentAt" name="sentAt" type="date" value={sentAtValue} onChange={(e) => setSentAtValue(e.target.value)} required />
                  </FormField>
                  <FormField id="sentVia" label={t('sentVia')} required error={errors.sentVia} size="s">
                    <Select id="sentVia" name="sentVia" value={sentViaValue} onChange={(e) => setSentViaValue(e.target.value)} required>
                      {channels.map((channel) => (
                        <option key={channel.key} value={channel.key}>
                          {channel.label}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField id="note" label={t('note')}>
                    <Input id="note" name="note" value={noteValue} onChange={(e) => setNoteValue(e.target.value)} />
                  </FormField>
                </FormGrid>
              </div>

              <FormActionBar placement="dialog" mode="create" cancel={() => setOpen(false)} saveLabel={t('submit')} state={state} />
            </ActionForm>
          </DialogContent>
        </Dialog>

        <ConfirmDialog
          open={clearing}
          onOpenChange={setClearing}
          title={t('clearTitle')}
          description={t('clearDescription')}
          confirmLabel={t('clearConfirm')}
          destructive
          action={() => clearDispatchAction(documentId)}
        />
      </Section>
    </section>
  );
}
