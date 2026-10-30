'use client';

import type { InvitationRunKind, InvitationRunPreview } from '@kompass/module-governance';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormCard } from '@/components/forms/form-card';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Notice } from '@/components/notice';
import { StatusBadge } from '@/components/status-badge';
import { Steps, stepsFrom } from '@/components/steps';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { startInvitationRunAction } from '../actions';


/**
 * Vorschau eines Einladungslaufs mit „Einladungen ausstellen“ (Plan U1 Task 6). Der Hinweis „nur hier in Kompass“ steht
 * nur, solange der Verein Agenten das Ausstellen nicht erlaubt (`governance.mcpHumanOnlyAllowed`, `agentsAllowed`).
 */
export function InvitationStart({ meetingId, kind, preview, names, canStart, agentsAllowed }: { meetingId: string; kind: InvitationRunKind; preview: InvitationRunPreview; names: Record<string, string>; canStart: boolean; agentsAllowed: boolean }) {
  const t = useTranslations('governance.invite.run');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const mail = preview.recipients.filter((r) => r.channel === 'email').length;
  const post = preview.recipients.length - mail;
  const start = async () => {
    setPending(true);
    await feedback.run(() => startInvitationRunAction(meetingId, kind), { retry: () => void start() });
    setPending(false);
  };
  const steps = stepsFrom((['preview', 'issue', 'dispatch'] as const).map((key) => ({ key, label: t(`steps.${key}`) })), 'preview');

  return (
    <div className="flex flex-col gap-4">
      <Steps label={t('steps.label')} steps={steps} />
      <p className="text-body text-ink" data-testid="invitation-counts">{t('counts', { letters: preview.recipients.length, mail, post })}</p>
      {preview.warnings.map((w) => (
        <Notice key={w} level="warn">{t(`warnings.${w}`)}</Notice>
      ))}
      {preview.recipients.length === 0 ? (
        <p className="text-meta text-muted-ink">{t('empty')}</p>
      ) : (
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead col="title">{t('columns.member')}</TableHead>
                <TableHead col="meta">{t('columns.number')}</TableHead>
                <TableHead col="meta">{t('columns.channel')}</TableHead>
                <TableHead col="meta">{t('columns.voting')}</TableHead>
                <TableHead col="status">{t('columns.note')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.recipients.map((r) => (
                <TableRow key={r.membershipId}>
                  <TableCell col="title">{names[r.contactId] ?? ''}</TableCell>
                  <TableCell col="meta">{r.memberNumber}</TableCell>
                  <TableCell col="meta">{t(`channel.${r.channel}`)}</TableCell>
                  <TableCell col="meta">{t(r.hasVotingRight ? 'voting.yes' : 'voting.no')}</TableCell>
                  <TableCell col="status">{r.refusal === 'addressMissing' ? <StatusBadge tone="warning" dot>{t('addressMissing')}</StatusBadge> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {canStart ? (
        <FormCard>
          <FormActionBar
            mode="run"
            testId="invitation-footer"
            note={agentsAllowed ? undefined : <span className="max-w-prose text-hint text-muted-ink">{t('humanOnly')}</span>}
            saveLabel={t(`start.${kind}`)}
            saveDisabled={preview.recipients.length === 0 || pending}
            pending={pending}
            onSave={() => void start()}
            state={feedback.state}
          />
        </FormCard>
      ) : (
        <p className="text-meta text-ink-2">{t('noRight')}</p>
      )}
    </div>
  );
}
