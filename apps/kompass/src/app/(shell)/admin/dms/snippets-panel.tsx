'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableEmpty, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { idleState, type ActionState } from '@/lib/actions';
import { createSnippetAction, deleteSnippetAction, updateSnippetAction } from './actions';
import { ActionForm } from '@/components/forms/action-form';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';

export interface SnippetRow {
  id: string;
  name: string;
  subject: string | null;
  body: string;
  sortOrder: number;
  isActive: boolean;
}

/** Absätze und Standardbriefe, die der Editor auf Wunsch einfügt. Ohne Platzhalter. */
export function SnippetsPanel({ snippets }: { snippets: SnippetRow[] }) {
  const t = useTranslations('dms.admin');
  const tCommon = useTranslations('common');
  const [editing, setEditing] = useState<SnippetRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<SnippetRow | null>(null);
  const open = creating || editing !== null;

  const [state, action] = useActionState(async (prev: ActionState, formData: FormData) => {
    const res = editing ? await updateSnippetAction(editing.id, prev, formData) : await createSnippetAction(prev, formData);
    if (res.status === 'success') {
      setCreating(false);
      setEditing(null);
      if (res.message) toast.success(res.message);
    }
    return res;
  }, idleState);

  return (
    <section className="space-y-4 rounded-md border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[13px] text-ink-2">{t('snippetsDescription')}</p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          {t('createSnippet')}
        </Button>
      </div>

      <div className="overflow-hidden rounded-md border border-line">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('snippetColumns.name')}</TableHead>
              <TableHead>{t('snippetColumns.subject')}</TableHead>
              <TableHead>{t('snippetColumns.active')}</TableHead>
              <TableHead className="text-right">{t('snippetColumns.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {snippets.length === 0 ? (
              <TableEmpty colSpan={4}>{t('emptySnippets')}</TableEmpty>
            ) : (
              snippets.map((snippet) => (
                <TableRow key={snippet.id}>
                  <TableCell className="font-semibold text-ink">{snippet.name}</TableCell>
                  <TableCell className="text-ink-2">{snippet.subject ?? '—'}</TableCell>
                  <TableCell className="text-ink-2">{snippet.isActive ? tCommon('yes') : tCommon('no')}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(snippet)}>
                      {t('edit')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setToDelete(snippet)}>
                      {t('delete')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) {
            setCreating(false);
            setEditing(null);
          }
        }}
      >
        <DialogContent size="lg" className="bg-surface shadow-md">
          <ActionForm action={action} state={state}>
            <DialogTitle>
              {editing ? t('editSnippetTitle') : t('createSnippetTitle')}
            </DialogTitle>
            <DialogDescription>{t('snippetsDescription')}</DialogDescription>

            <div className="mt-5">
              <FormGrid>
                <FormField id="snippet-name" label={t('snippetFields.name')} required>
                  <Input id="snippet-name" name="name" defaultValue={editing?.name ?? ''} required />
                </FormField>
                <FormField id="snippet-subject" label={t('snippetFields.subject')}>
                  <Input id="snippet-subject" name="subject" defaultValue={editing?.subject ?? ''} />
                </FormField>
                <FormField id="snippet-body" label={t('snippetFields.body')} required size="l">
                  <Textarea
                    id="snippet-body"
                    name="body"
                    rows={6}
                    defaultValue={editing?.body ?? ''}
                    required
                    className="font-mono text-[13px]"
                  />
                </FormField>
                <FormField id="snippet-sortOrder" label={t('snippetFields.sortOrder')} size="s">
                  <Input id="snippet-sortOrder" name="sortOrder" type="number" min={0} defaultValue={editing?.sortOrder ?? 0} />
                </FormField>
                {editing ? (
                  <FormField id="snippet-active" label={t('snippetColumns.active')} toggle>
                    <Checkbox id="snippet-active" name="isActive" defaultChecked={editing.isActive} value="on" />
                  </FormField>
                ) : null}
              </FormGrid>
            </div>

            <FormActionBar
              placement="dialog"
              mode="create"
              cancel={() => {
                setCreating(false);
                setEditing(null);
              }}
              saveLabel={tCommon('save')}
              state={state}
            />
          </ActionForm>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(next) => setToDelete(next ? toDelete : null)}
        title={t('deleteSnippetTitle')}
        description={t('deleteSnippetDescription', { name: toDelete?.name ?? '' })}
        confirmLabel={t('deleteSnippetConfirm')}
        destructive
        action={() => deleteSnippetAction(toDelete?.id ?? '')}
      />
    </section>
  );
}
