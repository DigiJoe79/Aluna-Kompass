'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { idleState } from '@/lib/actions';
import { cn } from '@/lib/utils';
import { createDocumentFolderAction, deleteDocumentFolderAction } from './actions';

export function FoldersPanel({ folders }: { folders: string[] }) {
  const t = useTranslations('dms.admin');
  const tCommon = useTranslations('common');

  const [createOpen, setCreateOpen] = useState(false);
  const [folderToDelete, setFolderToDelete] = useState<string | null>(null);
  const [deletePending, startDeleteTransition] = useTransition();

  const [createState, createAction, createPending] = useActionState(async (prev: any, formData: FormData) => {
    const res = await createDocumentFolderAction(prev, formData);
    if (res.status === 'success') {
      setCreateOpen(false);
      toast.success(res.message);
    }
    return res;
  }, idleState);

  const handleDelete = (path: string) => {
    startDeleteTransition(async () => {
      const res = await deleteDocumentFolderAction(path);
      if (res.status === 'success') {
        setFolderToDelete(null);
        if (res.message) toast.success(res.message);
      } else if (res.status === 'error') {
        toast.error(res.message);
      }
    });
  };

  return (
    <section className="space-y-4 rounded-md border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-heading text-[18px] text-ink">{t('foldersTitle')}</h3>
          <p className="text-[13px] text-muted-ink">{t('foldersDescription')}</p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          {t('createFolder')}
        </Button>
      </div>

      <div className="overflow-hidden rounded-md border border-line">
        <Table>
          <TableHeader className="bg-table-head text-left text-[12px] font-semibold uppercase tracking-[.04em] text-muted-ink">
            <TableRow className="h-9">
              <TableHead className="px-4">{t('folderColumns.path')}</TableHead>
              <TableHead className="px-4 text-right">{t('folderColumns.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {folders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={2} className="px-4 py-6 text-center text-[13px] text-muted-ink">
                  {t('emptyFolders')}
                </TableCell>
              </TableRow>
            ) : (
              folders.map((path, i) => (
                <TableRow key={path} className={cn('h-12 border-b border-line-2', i % 2 === 1 && 'bg-zebra')}>
                  <TableCell className="px-4 font-mono font-medium text-ink">{path}</TableCell>
                  <TableCell className="px-4 text-right">
                    <Button variant="ghost" size="sm" onClick={() => setFolderToDelete(path)}>
                      {t('delete')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Dialog: Create Folder */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-surface shadow-md sm:max-w-[440px]">
          <form action={createAction} className="space-y-4">
            <DialogTitle className="font-heading text-[19px]">{t('createFolderTitle')}</DialogTitle>
            <DialogDescription className="text-[13px] text-muted-ink">{t('createFolderDescription')}</DialogDescription>

            {createState.status === 'error' && (
              <div className="rounded-md bg-error-bg p-2.5 text-[13px] text-error">{createState.message}</div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="folder-path">{t('folderPath')}</Label>
              <Input id="folder-path" name="path" placeholder="z. B. behoerden/finanzamt" required />
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

      {/* Dialog: Confirm Delete Folder */}
      <Dialog open={Boolean(folderToDelete)} onOpenChange={(open) => !open && setFolderToDelete(null)}>
        <DialogContent className="bg-surface shadow-md sm:max-w-[440px]">
          <DialogTitle className="font-heading text-[19px]">{t('deleteFolderTitle')}</DialogTitle>
          <DialogDescription className="text-[13px] text-muted-ink">
            {folderToDelete ? t('deleteFolderDescription', { path: folderToDelete }) : ''}
          </DialogDescription>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setFolderToDelete(null)}>
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deletePending}
              onClick={() => folderToDelete && handleDelete(folderToDelete)}
            >
              {t('deleteFolderConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
