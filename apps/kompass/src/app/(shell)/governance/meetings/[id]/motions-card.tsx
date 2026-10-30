'use client';

import type { AgendaItemView, MotionView } from '@kompass/module-governance';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { FormField } from '@/components/forms/form-field';
import { RowMenu } from '@/components/row-menu';
import { Section } from '@/components/section';
import { StatusBadge, statusTone } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { saveMotionAction } from './actions';
import { MotionDialog } from './motion-dialog';

/**
 * „Anträge zur Tagesordnung“ (Board 2b B): Kopfsatz mit der Frist, je Antrag Text, wer und wann, „nach Frist“ als
 * Marke; „Aufnehmen …“ öffnet den Punkt-Dialog vorbelegt. Nichts wird abgewiesen (Anti-Ziel 1).
 */
export function MotionsCard({
  meetingId,
  motions,
  agenda,
  names,
  documentLabels,
  motionsBy,
  motionDays,
  today,
  editable,
  canPickContacts,
  canPickDocuments,
  onAdmit,
}: {
  meetingId: string;
  motions: MotionView[];
  agenda: AgendaItemView[];
  names: Record<string, string>;
  documentLabels: Record<string, string>;
  motionsBy: string | null;
  motionDays: number | null;
  today: string;
  editable: boolean;
  canPickContacts: boolean;
  canPickDocuments: boolean;
  onAdmit: (motion: MotionView) => void;
}) {
  const t = useTranslations('governance.motions');
  const ts = useTranslations('governance.states.agendaMotion');
  const { date } = useDateFormat();
  const [editing, setEditing] = useState<MotionView | 'new' | null>(null);
  const [withdrawing, setWithdrawing] = useState<MotionView | null>(null);
  const [withdrawnOn, setWithdrawnOn] = useState(today);
  const menu = useRef<HTMLButtonElement>(null);
  const position = (itemId: string | null) => agenda.find((i) => i.id === itemId)?.position;

  return (
    <Section
      title={t('title')}
      intro={motionsBy && motionDays !== null ? t('deadline', { days: motionDays, date: date(motionsBy) }) : t('deadlineNone')}
      actions={editable ? <Button type="button" variant="outline" size="sm" onClick={() => setEditing('new')} data-testid="motion-record">{t('record')}</Button> : undefined}
    >
      {motions.length === 0 ? (
        <p className="text-meta text-muted-ink">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col" data-testid="motions">
          {motions.map((m) => (
            <li key={m.id} className="flex flex-wrap items-start gap-x-3 gap-y-1.5 border-b border-line-2 py-2.5 last:border-b-0">
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-body">{m.text}</p>
                <p className="text-meta text-muted-ink">
                  {m.withdrawnOn
                    ? t('withdrawnOn', { date: date(m.withdrawnOn) })
                    : m.agendaItemId
                      ? t('admittedAs', { number: String(position(m.agendaItemId) ?? '') })
                      : m.submittedByContactId
                        ? t('by', { name: names[m.submittedByContactId] ?? '', date: date(m.receivedOn) })
                        : t('byUnknown', { date: date(m.receivedOn) })}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {m.late && !m.agendaItemId && !m.withdrawnOn ? <StatusBadge tone={statusTone('agendaMotion', 'late')} dot>{ts('late')}</StatusBadge> : null}
                {editable && !m.agendaItemId && !m.withdrawnOn ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => onAdmit(m)}>{t('admit')}</Button>
                ) : null}
                {editable ? (
                  <RowMenu
                    name={m.text.slice(0, 60)}
                    triggerRef={menu}
                    items={[
                      { key: 'edit', label: t('menu.edit'), onSelect: () => setEditing(m) },
                      { key: 'withdraw', label: t('menu.withdraw'), onSelect: () => { setWithdrawnOn(today); setWithdrawing(m); }, hidden: m.withdrawnOn !== null || m.agendaItemId !== null },
                    ]}
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <MotionDialog
          meetingId={meetingId}
          motion={editing === 'new' ? null : editing}
          names={names}
          today={today}
          canPickContacts={canPickContacts}
          canPickDocuments={canPickDocuments}
          documentLabel={editing !== 'new' && editing.documentId ? (documentLabels[editing.documentId] ?? null) : null}
          onClose={() => setEditing(null)}
        />
      ) : null}
      <ConfirmDialog
        open={withdrawing !== null}
        onOpenChange={(open) => (open ? undefined : setWithdrawing(null))}
        title={t('withdrawDialog.title')}
        description={t('withdrawDialog.description')}
        confirmLabel={t('withdrawDialog.confirm')}
        finalFocus={menu}
        action={() => {
          const m = withdrawing!;
          return saveMotionAction({ id: m.id, meetingId, submittedByContactId: m.submittedByContactId, receivedOn: m.receivedOn, text: m.text, documentId: m.documentId, agendaItemId: m.agendaItemId, withdrawnOn });
        }}
      >
        <FormField id="motion-withdrawn" label={t('withdrawDialog.on')} required size="s">
          <Input id="motion-withdrawn" type="date" value={withdrawnOn} onChange={(e) => setWithdrawnOn(e.target.value)} />
        </FormField>
      </ConfirmDialog>
    </Section>
  );
}
