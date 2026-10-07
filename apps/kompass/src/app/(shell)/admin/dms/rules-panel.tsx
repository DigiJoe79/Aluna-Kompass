'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableEmpty, TableHeader, TableRow } from '@/components/ui/table';
import { idleState } from '@/lib/actions';
import { cn } from '@/lib/utils';
import { createDocumentRuleAction, deleteDocumentRuleAction, updateDocumentRuleAction } from './actions';
import type { DocumentTypeItem } from './types-panel';
import { Select } from '@/components/ui/select';
import { ActionForm } from '@/components/forms/action-form';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { Checkbox } from '@/components/ui/checkbox';

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
  const deleteFb = useActionFeedback();

  const [createState, createAction] = useActionState(async (prev: any, formData: FormData) => {
    const res = await createDocumentRuleAction(prev, formData);
    if (res.status === 'success') {
      setCreateOpen(false);
      toast.success(res.message);
    }
    return res;
  }, idleState);

  const [editState, editAction] = useActionState(async (prev: any, formData: FormData) => {
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
      const res = await deleteFb.run(() => deleteDocumentRuleAction(id), { retry: () => handleDelete(id) });
      if (res.status === 'success') setRuleToDelete(null);
    });
  };

  const typeMap = new Map(types.map((t) => [t.key, t.label]));

  return (
    <section className="space-y-4 rounded-md border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[13px] text-ink-2">{t('rulesDescription')}</p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          {t('createRule')}
        </Button>
      </div>

      <div className="overflow-hidden rounded-md border border-line">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('ruleColumns.matchField')}</TableHead>
              <TableHead>{t('ruleColumns.matchContains')}</TableHead>
              <TableHead>{t('ruleColumns.thenType')}</TableHead>
              <TableHead>{t('ruleColumns.thenFolder')}</TableHead>
              <TableHead>{t('ruleColumns.status')}</TableHead>
              <TableHead className="text-right">{t('ruleColumns.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.length === 0 ? (
              <TableEmpty colSpan={6}>{t('emptyRules')}</TableEmpty>
            ) : (
              rules.map((row, i) => (
                <TableRow key={row.id}>
                  <TableCell className="text-[13px] text-ink">
                    {t(`ruleFields.${row.matchField}`)}
                  </TableCell>
                  <TableCell className="font-mono font-medium text-ink">{row.matchContains}</TableCell>
                  <TableCell className="text-ink-2">
                    {row.thenTypeKey ? typeMap.get(row.thenTypeKey) ?? row.thenTypeKey : '—'}
                  </TableCell>
                  <TableCell className="text-ink-2">{row.thenFolder ?? '—'}</TableCell>
                  <TableCell>
                    <StatusBadge tone={row.isActive ? 'success' : 'neutral'}>
                      {row.isActive ? t('active') : t('inactive')}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="text-right">
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
        <DialogContent size="md" className="bg-surface shadow-md">
          <ActionForm action={createAction} state={createState} className="space-y-4">
            <DialogTitle>{t('createRuleTitle')}</DialogTitle>
            <DialogDescription>{t('createRuleDescription')}</DialogDescription>

            <section>
              <h3 className="text-[15px] font-semibold">{t('ruleSections.condition')}</h3>
              <div className="mt-3">
                <FormGrid>
                  <FormField id="create-rule-field" label={t('ruleFields.matchField')} size="s">
                    <Select
                      id="create-rule-field"
                      name="matchField"
                      defaultValue="filename"
                    >
                      <option value="filename">{t('ruleFields.filename')}</option>
                      <option value="senderName">{t('ruleFields.senderName')}</option>
                    </Select>
                  </FormField>
                  <FormField id="create-rule-contains" label={t('ruleFields.matchContains')}>
                    <Input
                      id="create-rule-contains"
                      name="matchContains"
                      placeholder={t('ruleFields.matchContainsPlaceholder')}
                      required
                    />
                  </FormField>
                </FormGrid>
              </div>
            </section>
            <section className="border-t border-line pt-5">
              <h3 className="text-[15px] font-semibold">{t('ruleSections.result')}</h3>
              <div className="mt-3">
                <FormGrid>
                  <FormField id="create-rule-type" label={t('ruleFields.thenType')}>
                    <Select
                      id="create-rule-type"
                      name="thenTypeKey"
                      defaultValue=""
                    >
                      <option value="">{t('ruleFields.noType')}</option>
                      {types.map((tp) => (
                        <option key={tp.key} value={tp.key}>
                          {tp.label} ({tp.prefix})
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField id="create-rule-folder" label={t('ruleFields.thenFolder')}>
                    <Select
                      id="create-rule-folder"
                      name="thenFolder"
                      defaultValue=""
                    >
                      <option value="">{t('ruleFields.noFolder')}</option>
                      {folders.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                </FormGrid>
              </div>
            </section>

            <FormActionBar placement="dialog" mode="create" cancel={() => setCreateOpen(false)} saveLabel={t('save')} state={createState} />
          </ActionForm>
        </DialogContent>
      </Dialog>

      {/* Dialog: Edit Rule */}
      <Dialog open={Boolean(editingRule)} onOpenChange={(open) => !open && setEditingRule(null)}>
        <DialogContent size="md" className="bg-surface shadow-md">
          {editingRule && (
            <ActionForm action={editAction} state={editState} className="space-y-4">
              <DialogTitle>{t('editRuleTitle')}</DialogTitle>
              <DialogDescription>{t('editRuleDescription')}</DialogDescription>

              <section>
                <h3 className="text-[15px] font-semibold">{t('ruleSections.condition')}</h3>
                <div className="mt-3">
                  <FormGrid>
                    <FormField id="edit-rule-field" label={t('ruleFields.matchField')} size="s">
                      <Select
                        id="edit-rule-field"
                        name="matchField"
                        defaultValue={editingRule.matchField}
                      >
                        <option value="filename">{t('ruleFields.filename')}</option>
                        <option value="senderName">{t('ruleFields.senderName')}</option>
                      </Select>
                    </FormField>
                    <FormField id="edit-rule-contains" label={t('ruleFields.matchContains')}>
                      <Input
                        id="edit-rule-contains"
                        name="matchContains"
                        defaultValue={editingRule.matchContains}
                        required
                      />
                    </FormField>
                  </FormGrid>
                </div>
              </section>
              <section className="border-t border-line pt-5">
                <h3 className="text-[15px] font-semibold">{t('ruleSections.result')}</h3>
                <div className="mt-3">
                  <FormGrid>
                    <FormField id="edit-rule-type" label={t('ruleFields.thenType')}>
                      <Select
                        id="edit-rule-type"
                        name="thenTypeKey"
                        defaultValue={editingRule.thenTypeKey ?? ''}
                      >
                        <option value="">{t('ruleFields.noType')}</option>
                        {types.map((tp) => (
                          <option key={tp.key} value={tp.key}>
                            {tp.label} ({tp.prefix})
                          </option>
                        ))}
                      </Select>
                    </FormField>
                    <FormField id="edit-rule-folder" label={t('ruleFields.thenFolder')}>
                      <Select
                        id="edit-rule-folder"
                        name="thenFolder"
                        defaultValue={editingRule.thenFolder ?? ''}
                      >
                        <option value="">{t('ruleFields.noFolder')}</option>
                        {folders.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </Select>
                    </FormField>
                    <FormField id="edit-rule-active" label={t('ruleFields.activeCheckbox')} toggle>
                      <Checkbox id="edit-rule-active" name="isActive" defaultChecked={editingRule.isActive} value="on" />
                    </FormField>
                  </FormGrid>
                </div>
              </section>

              <FormActionBar placement="dialog" mode="create" cancel={() => setEditingRule(null)} saveLabel={t('save')} state={editState} />
            </ActionForm>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog: Confirm Delete Rule */}
      <Dialog open={Boolean(ruleToDelete)} onOpenChange={(open) => { if (!open) { setRuleToDelete(null); deleteFb.reset(); } }}>
        <DialogContent size="sm" className="bg-surface shadow-md">
          <DialogTitle>{t('deleteRuleTitle')}</DialogTitle>
          <DialogDescription tone="body">
            {t('deleteRuleDescription')}
          </DialogDescription>
          <FormActionBar placement="dialog" cancel={() => setRuleToDelete(null)} destructive pending={deletePending} saveLabel={t('deleteRuleConfirm')} onSave={() => ruleToDelete && handleDelete(ruleToDelete.id)} state={deleteFb.state} />
        </DialogContent>
      </Dialog>
    </section>
  );
}
