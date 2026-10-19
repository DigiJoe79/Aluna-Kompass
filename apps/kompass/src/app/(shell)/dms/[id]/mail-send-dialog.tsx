'use client';

import type { DocumentMailDraft, MailDraftRecipient } from '@kompass/module-dms';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Notice, type NoticeRemedy } from '@/components/notice';
import { Overline } from '@/components/overline';
import { panelHref } from '@/components/panel-nav';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { formatFileSize } from '@/lib/finance/expenses';
import { sendDocumentMailAction } from '../actions';

type MailRecipient = Extract<MailDraftRecipient, { channel: 'email' }>;

const SETTINGS = panelHref('/admin/dms', 'channels');

/**
 * Dialog „Per E-Mail senden“ am Dokument (Handoff 2b E2, 19b–19d): An, Betreff (fest), Begleittext als Vorschau,
 * Anhang. Was das Senden verhindert, steht als `Notice refuse` mit Ausweg über der Leiste, „Senden“ ist dann gesperrt;
 * die Testumgebung ist ein `warn`, „Senden“ bleibt frei. Bei mehreren Empfängern mit Adresse wählt eine `RadioGroup`.
 */
export function MailSendDialog({
  open,
  onOpenChange,
  documentId,
  draft,
  onRecordDispatch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  draft: DocumentMailDraft;
  /** „Versand vermerken …“ als Ausweg, wenn der Kontakt Post will. */
  onRecordDispatch: () => void;
}) {
  const t = useTranslations('dms.send');
  const tReason = useTranslations('dispatchStep.reason');
  const tDispatch = useTranslations('dms.dispatch');
  const router = useRouter();
  const feedback = useActionFeedback();
  const [pending, setPending] = useState(false);
  const mailable = draft.recipients.filter((r): r is MailRecipient => r.channel === 'email');
  const [chosen, setChosen] = useState<string | null>(mailable[0]?.contactId ?? null);
  const recipient = mailable.find((r) => r.contactId === chosen) ?? mailable[0] ?? null;
  const first = draft.recipients[0] ?? null;

  // Was verhindert das Senden? Der erste Grund zählt, mit seinen Auswegen.
  let refusal: { text: string; remedies: NoticeRemedy[] } | null = null;
  if (draft.mail.kind === 'off') refusal = { text: t('off'), remedies: [{ label: t('toSettings'), href: SETTINGS }] };
  else if (!draft.mail.sender) refusal = { text: t('noSender'), remedies: [{ label: t('toSettings'), href: SETTINGS }] };
  else if (!recipient && first?.channel === 'post') {
    const name = first.name ?? '';
    const contactHref = first.contactId ? `/contacts/${first.contactId}` : null;
    if (first.reason === 'noEmail') refusal = { text: t('noAddress', { name }), remedies: contactHref ? [{ label: t('addAddress'), href: contactHref }] : [] };
    else if (first.reason === 'preference')
      refusal = {
        text: t('wantsPost', { name }),
        remedies: [...(contactHref ? [{ label: t('changeWay'), href: contactHref }] : []), { label: tDispatch('markButton'), onSelect: () => { onOpenChange(false); onRecordDispatch(); } }],
      };
    else if (first.reason === 'notFinal') refusal = { text: t('notFinal'), remedies: [] };
    else if (first.reason === 'noRecipient') refusal = { text: t('noRecipient'), remedies: [] };
    else refusal = { text: tReason(first.reason), remedies: [] };
  }
  const blocked = draft.mail.kind === 'blocked';

  const submit = async () => {
    if (!recipient) return;
    setPending(true);
    const result = await feedback.run(() => sendDocumentMailAction(documentId, recipient.contactId), { retry: () => void submit() });
    setPending(false);
    // „Wird gesendet.“ sagt `run` selbst an (Meldung der Aktion).
    if (result.status !== 'success') return;
    onOpenChange(false);
    router.refresh();
  };

  const shownName = recipient?.name ?? first?.name ?? '';
  const addressOf = (r: MailRecipient) => (
    <>
      {r.name} · {r.address}
      {r.via === 'organization' ? <span className="text-meta text-muted-ink"> {t('ofOrg')}</span> : null}
    </>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" layout="fixed-footer">
        <DialogHeader>
          <DialogTitle>{t('mailTitle')}</DialogTitle>
          <DialogDescription>{t('mailText', { nr: draft.documentNumber ?? '' })}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Overline field>{t('to')}</Overline>
              {mailable.length > 1 ? (
                <RadioGroup aria-label={t('to')} value={recipient?.contactId ?? ''} onValueChange={(v) => setChosen(String(v))}>
                  {mailable.map((r) => (
                    <label key={r.contactId} className="flex items-center gap-2 text-body text-ink">
                      <RadioGroupItem value={r.contactId} />
                      <span>{addressOf(r)}</span>
                    </label>
                  ))}
                </RadioGroup>
              ) : recipient ? (
                <p className="text-body text-ink" data-testid="mail-to">{addressOf(recipient)}</p>
              ) : (
                <p className="text-body text-ink" data-testid="mail-to">
                  {shownName} <span className="text-meta text-muted-ink">{t('noAddressShort')}</span>
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Overline field>{t('subject')}</Overline>
              <p className="text-body text-ink">{draft.subject}</p>
            </div>
            {recipient ? (
              <div className="flex flex-col gap-1.5">
                <Overline field>{t('body')}</Overline>
                <div className="flex flex-col gap-2 rounded-md bg-surface-2 px-3 py-2.5">
                  <p className="whitespace-pre-line text-body text-ink" data-testid="mail-body">{recipient.body}</p>
                  <Link href={panelHref('/admin/dms', 'snippets')} className="text-meta text-link underline underline-offset-2">{t('bodyEdit')}</Link>
                </div>
              </div>
            ) : null}
            {draft.fileName ? (
              <div className="flex flex-col gap-1.5">
                <Overline field>{t('attachment')}</Overline>
                <p className="text-body text-ink">
                  {draft.fileName}
                  {draft.fileBytes ? <span className="text-meta text-muted-ink"> {formatFileSize(draft.fileBytes)}</span> : null}
                </p>
              </div>
            ) : null}
            {refusal ? (
              <Notice level="refuse" title={t('refuseTitle')} remedies={refusal.remedies} testId="mail-send-refusal">{refusal.text}</Notice>
            ) : blocked ? (
              <Notice level="warn" title={t('redirectTitle')} action={<Link href={SETTINGS} className="text-meta text-link underline underline-offset-2">{t('toSettings')}</Link>}>{t('blocked')}</Notice>
            ) : draft.mail.kind === 'redirect' && draft.mail.redirectTo ? (
              <Notice level="warn" title={t('redirectTitle')} testId="mail-send-redirect">{t('redirect', { to: draft.mail.redirectTo })}</Notice>
            ) : null}
          </div>
        </DialogBody>
        <FormActionBar
          placement="dialog"
          mode="run"
          cancel={() => onOpenChange(false)}
          onSave={() => void submit()}
          pending={pending}
          saveDisabled={refusal !== null || blocked || !recipient}
          saveLabel={t('submit')}
          state={feedback.state}
          testId="mail-send-footer"
        />
      </DialogContent>
    </Dialog>
  );
}
