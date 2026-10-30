'use client';

import type { MeetingContext, MeetingDetail } from '@kompass/module-governance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { ReceiptDrop } from '@/components/finance/receipt-drop';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { RequirementList, type RequirementListItem } from '@/components/requirement-list';
import { RowMenu } from '@/components/row-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Textarea } from '@/components/ui/textarea';
import { openPoints, type OpenPoint } from '@/lib/governance/open-points';
import { acceptLaterAction, fileSignedMinutesAction, issueAttendanceListAction, issueRegisterDataAction, reopenMeetingAction, replaceSignedMinutesAction } from './actions';
import type { StepSlot } from './meeting-view';

const link = 'text-link underline-offset-2 hover:underline';

/**
 * Schritt 4 „Protokoll“ (Board 2c, wie die Amtsübergabe): Entwurf als PDF, unterschriebene Fassung als Scan ablegen,
 * Anwesenheitsliste und Angaben für die Registeranmeldung ausstellen, die offenen Punkte aus dem Mitlauf — mit
 * „Annahme erfassen …“ und, solange keine Fassung abgelegt ist, „Mitlauf wieder öffnen …“. Vor dem Festschreiben lässt
 * sich die abgelegte Fassung über ⋯ „Fassung ersetzen …“ mit Grund ersetzen (G-13).
 */
export function useMinutesStep({ meeting: m, context: c, canManage, canRecord, today }: { meeting: MeetingDetail; context: MeetingContext; canManage: boolean; canRecord: boolean; today: string }): StepSlot {
  const t = useTranslations('governance.minutes');
  const { date } = useDateFormat();
  const router = useRouter();
  const feedback = useActionFeedback();
  const [pending, setPending] = useState(false);
  const [accepting, setAccepting] = useState<Extract<OpenPoint, { kind: 'acceptanceOpen' }> | null>(null);
  const [acceptedOn, setAcceptedOn] = useState(today);
  const [answer, setAnswer] = useState<'accept' | 'decline'>('accept');
  const [reopening, setReopening] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [replaceReason, setReplaceReason] = useState('');
  const recorded = m.state === 'recorded';
  const filed = c.minutes.at(-1);
  const points = openPoints(m, c.names);
  const run = async (fn: () => ReturnType<typeof issueAttendanceListAction>) => {
    setPending(true);
    const result = await feedback.run(fn);
    setPending(false);
    if (result.status === 'success') router.refresh();
  };
  const upload = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    const data = new FormData();
    data.set('meetingId', m.id);
    data.set('file', file);
    await run(() => fileSignedMinutesAction(data));
  };
  if (m.state !== 'recorded' && m.state !== 'signed') return {};
  const doc = (d: { documentId: string; number: string | null } | null | undefined) =>
    d ? <Link href={`/dms/${d.documentId}`} className={`${link} font-mono`}>{d.number ?? ''}</Link> : null;
  const base = { blocked: false, canSelf: true, canDoNames: [], canDoText: '', href: null, actionLabel: '', doneLabel: t('issued') };
  const assembly = c.organ.kind === 'assembly';
  const representativeElected = m.resolutions.some((r) => r.kind === 'election' && c.offices.find((o) => o.id === (r.details as { officeId?: string } | null)?.officeId)?.representative);
  const items: RequirementListItem[] = [
    { ...base, key: 'draft', title: t('draft'), done: true, detail: m.endedAt ? t('draftDetail', { time: m.endedAt }) : undefined, extra: canRecord && recorded ? <a href={`/governance/meetings/${m.id}/minutes-draft`} className={link} target="_blank" rel="noreferrer" data-testid="minutes-draft">{t('pdf')}</a> : undefined },
    { ...base, key: 'signed', title: t('signed'), done: !!filed, detail: filed ? date(filed.filedAt) : undefined, extra: filed ? (
        <span className="flex items-center gap-2">
          {doc({ documentId: filed.documentId, number: filed.documentNumber })}
          {recorded && canManage ? <RowMenu name={t('signed')} items={[{ key: 'replace', label: t('replace'), onSelect: () => { setReplaceReason(''); setReplacing(true); } }]} /> : null}
        </span>
      ) : undefined },
    ...(assembly ? [{ ...base, key: 'attendance', title: t('attendanceList'), done: !!c.issued.attendanceList, extra: c.issued.attendanceList ? doc(c.issued.attendanceList) : canManage ? <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => void run(() => issueAttendanceListAction(m.id))}>{t('issue')}</Button> : undefined }] : []),
    ...(representativeElected ? [{ ...base, key: 'register', title: t('registerData'), done: !!c.issued.registerData, extra: c.issued.registerData ? doc(c.issued.registerData) : canManage ? <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => void run(() => issueRegisterDataAction(m.id))}>{t('issue')}</Button> : undefined }] : []),
    ...points.map((p) => ({
      ...base,
      key: p.key,
      title: p.kind === 'acceptanceOpen' ? t('acceptanceOpen', { n: p.itemNumber, name: p.name }) : t(p.kind, { n: p.itemNumber }),
      done: false,
      extra:
        p.kind === 'acceptanceOpen' && canRecord ? (
          <Button type="button" variant="outline" size="sm" onClick={() => { setAcceptedOn(today); setAnswer('accept'); setAccepting(p); }}>{t('acceptLater')}</Button>
        ) : recorded && canRecord && !filed ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setReopening(true)}>{t('reopen')}</Button>
        ) : (
          <span className="text-meta text-muted-ink">{t('reopenAfterFiled')}</span>
        ),
    })),
  ];
  return {
    detail: filed ? undefined : t('detail'),
    below: (
      <div className="flex flex-col gap-3" data-testid="minutes-step">
        <RequirementList variant="rows" items={items} />
        {recorded && !filed && canRecord ? (
          <div data-testid="minutes-drop">
            <ReceiptDrop onFiles={(files) => void upload(files)} disabled={pending} />
          </div>
        ) : null}
        <RefusalNotice action state={feedback.state} />
        <ConfirmDialog
          open={accepting !== null}
          onOpenChange={(o) => (o ? undefined : setAccepting(null))}
          title={t('acceptDialog.title')}
          description={t('acceptDialog.description')}
          confirmLabel={t('acceptDialog.confirm')}
          action={async () => {
            const result = await acceptLaterAction(m.id, { resolutionId: accepting!.resolutionId, contactId: accepting!.contactId, acceptedOn, declined: answer === 'decline' });
            if (result.status === 'success') router.refresh();
            return result;
          }}
        >
          <FormGrid>
            <FormField id="accept-on" label={t('acceptDialog.on')} required size="s">
              <Input id="accept-on" type="date" value={acceptedOn} onChange={(e) => setAcceptedOn(e.target.value)} />
            </FormField>
            <FormField id="accept-answer" label={t('acceptDialog.answer')}>
              <Segmented className="self-start" aria-label={t('acceptDialog.answer')} value={answer} onValueChange={setAnswer} options={[{ value: 'accept', label: t('acceptDialog.accept') }, { value: 'decline', label: t('acceptDialog.decline') }]} />
            </FormField>
          </FormGrid>
        </ConfirmDialog>
        <ConfirmDialog
          open={replacing}
          onOpenChange={setReplacing}
          title={t('replaceDialog.title')}
          description={t('replaceDialog.description')}
          confirmLabel={t('replaceDialog.confirm')}
          confirmDisabled={replaceReason.trim() === ''}
          destructive
          action={async () => {
            const result = await replaceSignedMinutesAction(m.id, replaceReason.trim());
            if (result.status === 'success') router.refresh();
            return result;
          }}
        >
          <FormField id="replace-reason" label={t('replaceDialog.reason')} required size="full">
            <Textarea id="replace-reason" rows={2} maxLength={300} value={replaceReason} onChange={(e) => setReplaceReason(e.target.value)} />
          </FormField>
        </ConfirmDialog>
        <ConfirmDialog open={reopening} onOpenChange={setReopening} title={t('reopenDialog.title')} description={t('reopenDialog.description')} confirmLabel={t('reopenDialog.confirm')} action={() => reopenMeetingAction(m.id)} />
      </div>
    ),
  };
}
