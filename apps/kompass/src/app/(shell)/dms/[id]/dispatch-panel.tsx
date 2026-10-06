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

/**
 * Der Versandvermerk steht neben dem Dokument, nicht darin: Er ändert nichts
 * am festgeschriebenen Blatt und darf deshalb nachgetragen und berichtigt
 * werden — was, wann und durch wen, hält das Protokoll fest.
 */
export function DispatchPanel({
  documentId,
  sentAt,
  sentVia,
  sentNote,
  channels,
  today,
  canEdit,
}: {
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

  return (
    <section data-testid="dispatch-panel" className="rounded-md border border-line bg-surface p-5 shadow-xs">
      <h3 className="mb-3 text-[15px] font-semibold text-ink">{t('title')}</h3>

      {sentAt ? (
        <dl className="space-y-2 text-[13px]">
          <div>
            <dt className="text-muted-ink">{t('sentAt')}</dt>
            <dd className="font-medium text-ink">{fmt.date(sentAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-ink">{t('sentVia')}</dt>
            <dd className="font-medium text-ink">{channelLabel}</dd>
          </div>
          {sentNote ? (
            <div>
              <dt className="text-muted-ink">{t('note')}</dt>
              <dd className="text-ink-2">{sentNote}</dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className="text-[13px] text-muted-ink">{t('none')}</p>
      )}

      {canEdit ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
            {sentAt ? t('change') : t('record')}
          </Button>
          {sentAt ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setClearing(true)}>
              {t('clear')}
            </Button>
          ) : null}
        </div>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="md" className="bg-surface shadow-md">
          <ActionForm action={action} state={state}>
            <DialogTitle className="font-heading text-[19px]">{t('record')}</DialogTitle>
            <DialogDescription className="text-[13px] text-muted-ink">{t('description')}</DialogDescription>

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
    </section>
  );
}
