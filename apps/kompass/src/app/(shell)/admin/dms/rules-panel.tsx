'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { idleState } from '@/lib/actions';
import { cn } from '@/lib/utils';
import { createDocumentRuleAction, deleteDocumentRuleAction, updateDocumentRuleAction } from './actions';
import type { DocumentTypeItem } from './types-panel';

export interface DocumentRuleItem {
  id: string;
  matchField: 'filename' | 'senderName';
  matchContains: string;
  thenTypeKey: string | null;
  thenFolder: string | null;
  isActive: boolean;
  sortOrder: number;
}

export function RulesPanel({
  rules,
  types,
  folders,
}: {
  rules: DocumentRuleItem[];
  types: DocumentTypeItem[];
  folders: string[];
}) {
  const t = useTranslations('dms.admin');
  const tCommon = useTranslations('common');

  const [createOpen, setCreateOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<DocumentRuleItem | null>(null);
  const [ruleToDelete, setRuleToDelete] = useState<DocumentRuleItem | null>(null);
  const [deletePending, startDeleteTransition] = useTransition();

  const [createState, createAction, createPending] = useActionState(async (prev: any, formData: FormData) => {
    const res = await createDocumentRuleAction(prev, formData);
    if (res.status === 'success') {
      setCreateOpen(false);
      toast.success(res.message);
    }
    return res;
  }, idleState);

  const [editState, editAction, editPending] = useActionState(async (prev: any, formData: FormData) => {
    if (!editingRule) return prev;
    const res = await updateDocumentRuleAction(editingRule.id, prev, formData);
    if (res.status === 'success') {
      setEditingRule(null);
      toast.success(res.message);
    }
    return res;
  }, idleState);

  const handleDelete = (id: string) => {
    startDeleteTransition(async () => {
      const res = await deleteDocumentRuleAction(id);
      if (res.status === 'success') {
        setRuleToDelete(null);
        if (res.message) toast.success(res.message);
      } else if (res.status === 'error') {
        toast.error(res.message);
      }
    });
  };

  const typeMap = new Map(types.map((t) => [t.key, t.label]));

  return (
    <section className="space-y-4 rounded-md border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-heading text-[18px] text-ink">{t('rulesTitle')}</h3>
          <p className="text-[13px] text-muted-ink">{t('rulesDescription')}</p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          {t('createRule')}
        </Button>
      </div>

      <div className="overflow-hidden rounded-md border border-line">
        <Table>
          <TableHeader className="bg-table-head text-left text-[12px] font-semibold uppercase tracking-[.04em] text-muted-ink">
            <TableRow className="h-9">
              <TableHead className="px-4">{t('ruleColumns.matchField')}</TableHead>
              <TableHead className="px-4">{t('ruleColumns.matchContains')}</TableHead>
              <TableHead className="px-4">{t('ruleColumns.thenType')}</TableHead>
              <TableHead className="px-4">{t('ruleColumns.thenFolder')}</TableHead>
              <TableHead className="px-4">{t('ruleColumns.status')}</TableHead>
              <TableHead className="px-4 text-right">{t('ruleColumns.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="px-4 py-6 text-center text-[13px] text-muted-ink">
                  {t('emptyRules')}
                </TableCell>
              </TableRow>
            ) : (
              rules.map((row, i) => (
                <TableRow key={row.id} className={cn('h-12 border-b border-line-2', i % 2 === 1 && 'bg-zebra')}>
                  <TableCell className="px-4 text-[13px] text-ink">
                    {t(`ruleFields.${row.matchField}`)}
                  </TableCell>
                  <TableCell className="px-4 font-mono font-medium text-ink">{row.matchContains}</TableCell>
                  <TableCell className="px-4 text-ink-2">
                    {row.thenTypeKey ? typeMap.get(row.thenTypeKey) ?? row.thenTypeKey : '—'}
                  </TableCell>
                  <TableCell className="px-4 text-ink-2">{row.thenFolder ?? '—'}</TableCell>
                  <TableCell className="px-4">
                    <StatusBadge tone={row.isActive ? 'success' : 'neutral'}>
                      {row.isActive ? t('active') : t('inactive')}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="px-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditingRule(row)}>
                        {t('edit')}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setRuleToDelete(row)}>
                        {t('delete')}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Dialog: Create Rule */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-surface shadow-md sm:max-w-[500px]">
          <form action={createAction} className="space-y-4">
            <DialogTitle className="font-heading text-[19px]">{t('createRuleTitle')}</DialogTitle>
            <DialogDescription className="text-[13px] text-muted-ink">{t('createRuleDescription')}</DialogDescription>

            {createState.status === 'error' && (
              <div className="rounded-md bg-error-bg p-2.5 text-[13px] text-error">{createState.message}</div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="create-rule-field">{t('ruleFields.matchField')}</Label>
                <select
                  id="create-rule-field"
                  name="matchField"
                  defaultValue="filename"
                  className="h-[34px] w-full rounded-md border border-line-strong bg-field px-2.5 text-[13px] text-ink shadow-xs"
                >
                  <option value="filename">{t('ruleFields.filename')}</option>
                  <option value="senderName">{t('ruleFields.senderName')}</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="create-rule-contains">{t('ruleFields.matchContains')}</Label>
                <Input
                  id="create-rule-contains"
                  name="matchContains"
                  placeholder={t('ruleFields.matchContainsPlaceholder')}
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="create-rule-type">{t('ruleFields.thenType')}</Label>
              <select
                id="create-rule-type"
                name="thenTypeKey"
                defaultValue=""
                className="h-[34px] w-full rounded-md border border-line-strong bg-field px-2.5 text-[13px] text-ink shadow-xs"
              >
                <option value="">{t('ruleFields.noType')}</option>
                {types.map((tp) => (
                  <option key={tp.key} value={tp.key}>
                    {tp.label} ({tp.prefix})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="create-rule-folder">{t('ruleFields.thenFolder')}</Label>
              <select
                id="create-rule-folder"
                name="thenFolder"
                defaultValue=""
                className="h-[34px] w-full rounded-md border border-line-strong bg-field px-2.5 text-[13px] text-ink shadow-xs"
              >
                <option value="">{t('ruleFields.noFolder')}</option>
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

      {/* Dialog: Edit Rule */}
      <Dialog open={Boolean(editingRule)} onOpenChange={(open) => !open && setEditingRule(null)}>
        <DialogContent className="bg-surface shadow-md sm:max-w-[500px]">
          {editingRule && (
            <form action={editAction} className="space-y-4">
              <DialogTitle className="font-heading text-[19px]">{t('editRuleTitle')}</DialogTitle>
              <DialogDescription className="text-[13px] text-muted-ink">{t('editRuleDescription')}</DialogDescription>

              {editState.status === 'error' && (
                <div className="rounded-md bg-error-bg p-2.5 text-[13px] text-error">{editState.message}</div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-rule-field">{t('ruleFields.matchField')}</Label>
                  <select
                    id="edit-rule-field"
                    name="matchField"
                    defaultValue={editingRule.matchField}
                    className="h-[34px] w-full rounded-md border border-line-strong bg-field px-2.5 text-[13px] text-ink shadow-xs"
                  >
                    <option value="filename">{t('ruleFields.filename')}</option>
                    <option value="senderName">{t('ruleFields.senderName')}</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="edit-rule-contains">{t('ruleFields.matchContains')}</Label>
                  <Input
                    id="edit-rule-contains"
                    name="matchContains"
                    defaultValue={editingRule.matchContains}
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-rule-type">{t('ruleFields.thenType')}</Label>
                <select
                  id="edit-rule-type"
                  name="thenTypeKey"
                  defaultValue={editingRule.thenTypeKey ?? ''}
                  className="h-[34px] w-full rounded-md border border-line-strong bg-field px-2.5 text-[13px] text-ink shadow-xs"
                >
                  <option value="">{t('ruleFields.noType')}</option>
                  {types.map((tp) => (
                    <option key={tp.key} value={tp.key}>
                      {tp.label} ({tp.prefix})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-rule-folder">{t('ruleFields.thenFolder')}</Label>
                <select
                  id="edit-rule-folder"
                  name="thenFolder"
                  defaultValue={editingRule.thenFolder ?? ''}
                  className="h-[34px] w-full rounded-md border border-line-strong bg-field px-2.5 text-[13px] text-ink shadow-xs"
                >
                  <option value="">{t('ruleFields.noFolder')}</option>
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
                  id="edit-rule-active"
                  name="isActive"
                  defaultChecked={editingRule.isActive}
                  className="size-4 rounded border-line"
                />
                <Label htmlFor="edit-rule-active" className="cursor-pointer text-[13px]">
                  {t('ruleFields.activeCheckbox')}
                </Label>
              </div>

              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setEditingRule(null)}>
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

      {/* Dialog: Confirm Delete Rule */}
      <Dialog open={Boolean(ruleToDelete)} onOpenChange={(open) => !open && setRuleToDelete(null)}>
        <DialogContent className="bg-surface shadow-md sm:max-w-[440px]">
          <DialogTitle className="font-heading text-[19px]">{t('deleteRuleTitle')}</DialogTitle>
          <DialogDescription className="text-[13px] text-muted-ink">
            {t('deleteRuleDescription')}
          </DialogDescription>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setRuleToDelete(null)}>
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deletePending}
              onClick={() => ruleToDelete && handleDelete(ruleToDelete.id)}
            >
              {t('deleteRuleConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
