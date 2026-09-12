'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { SubmitButton } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { idleState, type ActionState } from '@/lib/actions';
import { createSnippetAction, deleteSnippetAction, updateSnippetAction } from './actions';

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
    } else if (res.status === 'error') {
      toast.error(res.message);
    }
    return res;
  }, idleState);

  return (
    <section className="space-y-4 rounded-md border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-heading text-[18px] text-ink">{t('snippetsTitle')}</h3>
          <p className="text-[13px] text-muted-ink">{t('snippetsDescription')}</p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          {t('createSnippet')}
        </Button>
      </div>

      <div className="overflow-hidden rounded-md border border-line">
        <Table>
          <TableHeader className="bg-table-head text-left text-[12px] font-semibold uppercase tracking-[.04em] text-muted-ink">
            <TableRow className="h-9">
              <TableHead className="px-4">{t('snippetColumns.name')}</TableHead>
              <TableHead className="px-4">{t('snippetColumns.subject')}</TableHead>
              <TableHead className="px-4">{t('snippetColumns.active')}</TableHead>
              <TableHead className="px-4 text-right">{t('snippetColumns.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {snippets.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="px-4 py-6 text-center text-[13px] text-muted-ink">
                  {t('emptySnippets')}
                </TableCell>
              </TableRow>
            ) : (
              snippets.map((snippet) => (
                <TableRow key={snippet.id} className="h-[var(--row-h)] border-b border-line-2">
                  <TableCell className="px-4 font-semibold text-ink">{snippet.name}</TableCell>
                  <TableCell className="px-4 text-ink-2">{snippet.subject ?? '—'}</TableCell>
                  <TableCell className="px-4 text-ink-2">{snippet.isActive ? tCommon('yes') : tCommon('no')}</TableCell>
                  <TableCell className="px-4 text-right">
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
        <DialogContent className="w-full sm:max-w-[640px] bg-surface p-6 shadow-md">
          <form action={action}>
            <DialogTitle className="font-heading text-[19px]">
              {editing ? t('editSnippetTitle') : t('createSnippetTitle')}
            </DialogTitle>
            <DialogDescription className="text-[13px] text-muted-ink">{t('snippetsDescription')}</DialogDescription>

            <div className="mt-5 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="snippet-name" required>
                  {t('snippetFields.name')}
                </Label>
                <Input id="snippet-name" name="name" defaultValue={editing?.name ?? ''} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="snippet-subject">{t('snippetFields.subject')}</Label>
                <Input id="snippet-subject" name="subject" defaultValue={editing?.subject ?? ''} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="snippet-body" required>
                  {t('snippetFields.body')}
                </Label>
                <Textarea
                  id="snippet-body"
                  name="body"
                  rows={6}
                  defaultValue={editing?.body ?? ''}
                  required
                  className="font-mono text-[13px]"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="snippet-sortOrder">{t('snippetFields.sortOrder')}</Label>
                <Input id="snippet-sortOrder" name="sortOrder" type="number" min={0} defaultValue={editing?.sortOrder ?? 0} />
              </div>
              {editing ? (
                <label className="flex items-center gap-2 text-[13px] text-ink-2">
                  <Checkbox name="isActive" defaultChecked={editing.isActive} value="on" />
                  {t('snippetColumns.active')}
                </label>
              ) : null}
            </div>

            {state.status === 'error' ? (
              <p role="alert" className="mt-3 text-[13px] text-error">
                {state.message}
              </p>
            ) : null}

            <DialogFooter className="mt-6">
              <span className="mr-auto text-[12px] text-muted-ink">{tCommon('requiredLegend')}</span>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setCreating(false);
                  setEditing(null);
                }}
              >
                {tCommon('cancel')}
              </Button>
              <SubmitButton>{tCommon('save')}</SubmitButton>
            </DialogFooter>
          </form>
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
