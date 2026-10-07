'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { saveDispatchChannelsAction } from './actions';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';

export interface DispatchChannelRow {
  key: string;
  label: string;
}

/**
 * Die Wege, die ein Versandvermerk kennt. Eine Einstellung, kein Datensatz je
 * Zeile — geschrieben wird deshalb immer die ganze Liste. Ein entfernter Weg
 * bleibt an alten Vermerken als Schlüssel lesbar.
 */
export function DispatchChannelsPanel({
  channels,
  canManageSettings,
}: {
  channels: DispatchChannelRow[];
  canManageSettings: boolean;
}) {
  const t = useTranslations('dms.admin');
  const tCommon = useTranslations('common');
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<DispatchChannelRow | null>(null);
  const [toRemove, setToRemove] = useState<DispatchChannelRow | null>(null);
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [pending, start] = useTransition();
  const feedback = useActionFeedback();
  const resetFeedback = feedback.reset;

  const save = (next: DispatchChannelRow[]) =>
    start(async () => {
      const state = await feedback.run(() => saveDispatchChannelsAction(next), { retry: () => save(next) });
      if (state.status !== 'success') return;
      setCreating(false);
      setRenaming(null);
      setToRemove(null);
      setKey('');
      setLabel('');
    });

  return (
    <section className="space-y-4 rounded-md border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[13px] text-ink-2">{t('channelsDescription')}</p>
        </div>
        {canManageSettings ? (
          <Button
            size="sm"
            onClick={() => {
              setKey('');
              setLabel('');
              setCreating(true);
            }}
          >
            {t('createChannel')}
          </Button>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-md border border-line">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('channelColumns.key')}</TableHead>
              <TableHead>{t('channelColumns.label')}</TableHead>
              <TableHead className="text-right">{t('channelColumns.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {channels.map((channel) => (
              <TableRow key={channel.key}>
                <TableCell className="font-mono text-[13px] text-ink-2">{channel.key}</TableCell>
                <TableCell className="font-semibold text-ink">{channel.label}</TableCell>
                <TableCell className="text-right">
                  {canManageSettings ? (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setLabel(channel.label);
                          setRenaming(channel);
                        }}
                      >
                        {t('edit')}
                      </Button>
                      <Button variant="ghost" size="sm" disabled={channels.length <= 1} onClick={() => setToRemove(channel)}>
                        {t('delete')}
                      </Button>
                    </>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {channels.length <= 1 ? <p className="text-[12px] text-muted-ink">{t('lastChannel')}</p> : null}

      <Dialog
        open={creating || renaming !== null}
        onOpenChange={(next) => {
          if (!next) {
            setCreating(false);
            setRenaming(null);
            resetFeedback();
          }
        }}
      >
        <DialogContent size="md" className="bg-surface shadow-md">
          <DialogTitle>
            {renaming ? t('renameChannelTitle') : t('createChannelTitle')}
          </DialogTitle>
          <DialogDescription>{t('channelsDescription')}</DialogDescription>

          <div className="mt-5">
            <FormGrid>
              {renaming ? null : (
                <FormField id="channel-key" label={t('channelFields.key')} required size="s">
                  <Input
                    id="channel-key"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    pattern="[a-z][a-zA-Z0-9]*"
                    required
                    className="font-mono"
                  />
                </FormField>
              )}
              <FormField id="channel-label" label={t('channelFields.label')} required>
                <Input id="channel-label" value={label} onChange={(e) => setLabel(e.target.value)} required />
              </FormField>
            </FormGrid>
          </div>

          <FormActionBar
            placement="dialog"
            cancel={() => {
              setCreating(false);
              setRenaming(null);
              resetFeedback();
            }}
            pending={pending}
            saveDisabled={!label.trim() || (!renaming && !key.trim())}
            saveLabel={tCommon('save')}
            note={<span className="text-[12px] text-muted-ink">{tCommon('requiredLegend')}</span>}
            state={withUnplacedFieldErrors(feedback.state, [])}
            onSave={() =>
              save(
                renaming
                  ? channels.map((c) => (c.key === renaming.key ? { ...c, label: label.trim() } : c))
                  : [...channels, { key: key.trim(), label: label.trim() }],
              )
            }
          />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={toRemove !== null}
        onOpenChange={(next) => setToRemove(next ? toRemove : null)}
        title={t('removeChannelTitle')}
        description={t('removeChannelDescription', { label: toRemove?.label ?? '' })}
        confirmLabel={t('removeChannelConfirm')}
        destructive
        action={async () => {
          const next = channels.filter((c) => c.key !== toRemove?.key);
          return saveDispatchChannelsAction(next);
        }}
      />
    </section>
  );
}
