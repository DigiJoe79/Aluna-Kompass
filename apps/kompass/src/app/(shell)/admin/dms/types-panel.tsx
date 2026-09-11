'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { idleState } from '@/lib/actions';
import { cn } from '@/lib/utils';
import { createDocumentTypeAction, updateDocumentTypeAction } from './actions';

export interface DocumentTypeItem {
  key: string;
  label: string;
  prefix: string;
  defaultDirection: 'incoming' | 'outgoing';
  retentionClass: string;
  defaultFolder: string | null;
  isActive: boolean;
  sortOrder: number;
}

export function TypesPanel({
  types,
  folders,
}: {
  types: DocumentTypeItem[];
  folders: string[];
}) {
  const t = useTranslations('dms.admin');
  const tDms = useTranslations('dms');
  const tCommon = useTranslations('common');

  const [createOpen, setCreateOpen] = useState(false);
  const [editingType, setEditingType] = useState<DocumentTypeItem | null>(null);

  const [createState, createAction, createPending] = useActionState(async (prev: any, formData: FormData) => {
    const res = await createDocumentTypeAction(prev, formData);
    if (res.status === 'success') setCreateOpen(false);
    return res;
  }, idleState);

  const [editState, editAction, editPending] = useActionState(async (prev: any, formData: FormData) => {
    if (!editingType) return prev;
    const res = await updateDocumentTypeAction(editingType.key, prev, formData);
    if (res.status === 'success') setEditingType(null);
    return res;
  }, idleState);

  return (
    <section className="space-y-4 rounded-md border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-heading text-[18px] text-ink">{t('typesTitle')}</h3>
          <p className="text-[13px] text-muted-ink">{t('typesDescription')}</p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          {t('createType')}
        </Button>
      </div>

      <div className="overflow-hidden rounded-md border border-line">
        <Table>
          <TableHeader className="bg-table-head text-left text-[12px] font-semibold uppercase tracking-[.04em] text-muted-ink">
            <TableRow className="h-9">
              <TableHead className="px-4">{t('typeColumns.prefix')}</TableHead>
              <TableHead className="px-4">{t('typeColumns.label')}</TableHead>
              <TableHead className="px-4">{t('typeColumns.key')}</TableHead>
              <TableHead className="px-4">{t('typeColumns.direction')}</TableHead>
              <TableHead className="px-4">{t('typeColumns.retention')}</TableHead>
              <TableHead className="px-4">{t('typeColumns.folder')}</TableHead>
              <TableHead className="px-4">{t('typeColumns.status')}</TableHead>
              <TableHead className="px-4 text-right">{t('typeColumns.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {types.map((row, i) => (
              <TableRow key={row.key} className={cn('h-12 border-b border-line-2', i % 2 === 1 && 'bg-zebra')}>
                <TableCell className="px-4 font-mono font-bold text-ink">{row.prefix}</TableCell>
                <TableCell className="px-4 font-medium text-ink">{row.label}</TableCell>
                <TableCell className="px-4 font-mono text-[13px] text-muted-ink">{row.key}</TableCell>
                <TableCell className="px-4 text-ink-2">{tDms(`directions.${row.defaultDirection}`)}</TableCell>
                <TableCell className="px-4 text-ink-2">{t(`retentionClasses.${row.retentionClass}`)}</TableCell>
                <TableCell className="px-4 text-ink-2">{row.defaultFolder ?? '—'}</TableCell>
                <TableCell className="px-4">
                  <StatusBadge tone={row.isActive ? 'success' : 'neutral'}>
                    {row.isActive ? t('active') : t('inactive')}
                  </StatusBadge>
                </TableCell>
                <TableCell className="px-4 text-right">
                  <Button variant="ghost" size="sm" onClick={() => setEditingType(row)}>
                    {t('edit')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Dialog: Create Type */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-surface shadow-md sm:max-w-[500px]">
          <form action={createAction} className="space-y-4">
            <DialogTitle className="font-heading text-[19px]">{t('createTypeTitle')}</DialogTitle>
            <DialogDescription className="text-[13px] text-muted-ink">{t('createTypeDescription')}</DialogDescription>

            {createState.status === 'error' && (
              <div className="rounded-md bg-error-bg p-2.5 text-[13px] text-error">{createState.message}</div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="create-key">{t('typeColumns.key')}</Label>
                <Input id="create-key" name="key" placeholder="z. B. notice" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-prefix">{t('typeColumns.prefix')}</Label>
                <Input id="create-prefix" name="prefix" placeholder="z. B. NOT" maxLength={3} required />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="create-label">{t('typeColumns.label')}</Label>
              <Input id="create-label" name="label" required />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="create-direction">{t('typeColumns.direction')}</Label>
                <select
                  id="create-direction"
                  name="defaultDirection"
                  defaultValue="incoming"
                  className="h-[34px] w-full rounded-md border border-line-strong bg-field px-2.5 text-[13px] text-ink shadow-xs"
                >
                  <option value="incoming">{tDms('directions.incoming')}</option>
                  <option value="outgoing">{tDms('directions.outgoing')}</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="create-retention">{t('typeColumns.retention')}</Label>
                <select
                  id="create-retention"
                  name="retentionClass"
                  defaultValue="statutory10Y"
                  className="h-[34px] w-full rounded-md border border-line-strong bg-field px-2.5 text-[13px] text-ink shadow-xs"
                >
                  <option value="statutory10Y">{t('retentionClasses.statutory10Y')}</option>
                  <option value="statutory6Y">{t('retentionClasses.statutory6Y')}</option>
                  <option value="permanent">{t('retentionClasses.permanent')}</option>
                  <option value="consent">{t('retentionClasses.consent')}</option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="create-folder">{t('typeColumns.folder')}</Label>
              <select
                id="create-folder"
                name="defaultFolder"
                defaultValue=""
                className="h-[34px] w-full rounded-md border border-line-strong bg-field px-2.5 text-[13px] text-ink shadow-xs"
              >
                <option value="">{tDms('inbox')}</option>
                {folders.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                {tCommon('cancel')}
              </Button>
              <Button type="submit" disabled={createPending}>
                {t('save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog: Edit Type */}
      <Dialog open={Boolean(editingType)} onOpenChange={(open) => !open && setEditingType(null)}>
        <DialogContent className="bg-surface shadow-md sm:max-w-[500px]">
          {editingType && (
            <form action={editAction} className="space-y-4">
              <DialogTitle className="font-heading text-[19px]">{t('editTypeTitle')}</DialogTitle>
              <DialogDescription className="text-[13px] text-muted-ink">{t('editTypeDescription')}</DialogDescription>

              {editState.status === 'error' && (
                <div className="rounded-md bg-error-bg p-2.5 text-[13px] text-error">{editState.message}</div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-key">{t('typeColumns.key')}</Label>
                  <Input id="edit-key" value={editingType.key} disabled />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-prefix">{t('typeColumns.prefix')}</Label>
                  <Input id="edit-prefix" value={editingType.prefix} disabled />
                </div>
              </div>
              <p className="text-[12px] text-muted-ink">{t('typeImmutableHint')}</p>

              <div className="space-y-1.5">
                <Label htmlFor="edit-label">{t('typeColumns.label')}</Label>
                <Input id="edit-label" name="label" defaultValue={editingType.label} required />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-direction">{t('typeColumns.direction')}</Label>
                  <select
                    id="edit-direction"
                    name="defaultDirection"
                    defaultValue={editingType.defaultDirection}
                    className="h-[34px] w-full rounded-md border border-line-strong bg-field px-2.5 text-[13px] text-ink shadow-xs"
                  >
                    <option value="incoming">{tDms('directions.incoming')}</option>
                    <option value="outgoing">{tDms('directions.outgoing')}</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="edit-retention">{t('typeColumns.retention')}</Label>
                  <select
                    id="edit-retention"
                    name="retentionClass"
                    defaultValue={editingType.retentionClass}
                    className="h-[34px] w-full rounded-md border border-line-strong bg-field px-2.5 text-[13px] text-ink shadow-xs"
                  >
                    <option value="statutory10Y">{t('retentionClasses.statutory10Y')}</option>
                    <option value="statutory6Y">{t('retentionClasses.statutory6Y')}</option>
                    <option value="permanent">{t('retentionClasses.permanent')}</option>
                    <option value="consent">{t('retentionClasses.consent')}</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-folder">{t('typeColumns.folder')}</Label>
                <select
                  id="edit-folder"
                  name="defaultFolder"
                  defaultValue={editingType.defaultFolder ?? ''}
                  className="h-[34px] w-full rounded-md border border-line-strong bg-field px-2.5 text-[13px] text-ink shadow-xs"
                >
                  <option value="">{tDms('inbox')}</option>
                  {folders.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="edit-active"
                  name="isActive"
                  defaultChecked={editingType.isActive}
                  className="size-4 rounded border-line"
                />
                <Label htmlFor="edit-active" className="cursor-pointer text-[13px]">
                  {t('activeCheckbox')}
                </Label>
              </div>

              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setEditingType(null)}>
                  {tCommon('cancel')}
                </Button>
                <Button type="submit" disabled={editPending}>
                  {t('save')}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
