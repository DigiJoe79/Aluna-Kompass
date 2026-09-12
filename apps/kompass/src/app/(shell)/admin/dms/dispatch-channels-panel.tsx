'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { saveDispatchChannelsAction } from './actions';

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

  const save = (next: DispatchChannelRow[]) =>
    start(async () => {
      const state = await saveDispatchChannelsAction(next);
      if (state.status === 'error') toast.error(state.message);
      else if (state.status === 'success' && state.message) toast.success(state.message);
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
          <h3 className="font-heading text-[18px] text-ink">{t('channelsTitle')}</h3>
          <p className="text-[13px] text-muted-ink">{t('channelsDescription')}</p>
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
          <TableHeader className="bg-table-head text-left text-[12px] font-semibold uppercase tracking-[.04em] text-muted-ink">
            <TableRow className="h-9">
              <TableHead className="px-4">{t('channelColumns.key')}</TableHead>
              <TableHead className="px-4">{t('channelColumns.label')}</TableHead>
              <TableHead className="px-4 text-right">{t('channelColumns.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {channels.map((channel) => (
              <TableRow key={channel.key} className="h-[var(--row-h)] border-b border-line-2">
                <TableCell className="px-4 font-mono text-[13px] text-ink-2">{channel.key}</TableCell>
                <TableCell className="px-4 font-semibold text-ink">{channel.label}</TableCell>
                <TableCell className="px-4 text-right">
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
          }
        }}
      >
        <DialogContent className="w-full sm:max-w-[480px] bg-surface p-6 shadow-md">
          <DialogTitle className="font-heading text-[19px]">
            {renaming ? t('renameChannelTitle') : t('createChannelTitle')}
          </DialogTitle>
          <DialogDescription className="text-[13px] text-muted-ink">{t('channelsDescription')}</DialogDescription>

          <div className="mt-5 space-y-4">
            {renaming ? null : (
              <div className="space-y-1.5">
                <Label htmlFor="channel-key" required>
                  {t('channelFields.key')}
                </Label>
                <Input
                  id="channel-key"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  pattern="[a-z][a-zA-Z0-9]*"
                  required
                  className="font-mono"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="channel-label" required>
                {t('channelFields.label')}
              </Label>
              <Input id="channel-label" value={label} onChange={(e) => setLabel(e.target.value)} required />
            </div>
          </div>

          <DialogFooter className="mt-6">
            <span className="mr-auto text-[12px] text-muted-ink">{tCommon('requiredLegend')}</span>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setCreating(false);
                setRenaming(null);
              }}
            >
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              disabled={pending || !label.trim() || (!renaming && !key.trim())}
              onClick={() =>
                save(
                  renaming
                    ? channels.map((c) => (c.key === renaming.key ? { ...c, label: label.trim() } : c))
                    : [...channels, { key: key.trim(), label: label.trim() }],
                )
              }
            >
              {tCommon('save')}
            </Button>
          </DialogFooter>
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
