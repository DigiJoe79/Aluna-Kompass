'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { moveDocumentAction } from '../actions';

/** Der Ausgang aus dem Eingangskorb: der Ordner ist am Dokument änderbar. */
export function FolderPanel({
  documentId,
  folder,
  folders,
  canEdit,
}: {
  documentId: string;
  folder: string | null;
  folders: string[];
  canEdit: boolean;
}) {
  const t = useTranslations('dms');
  const [value, setValue] = useState(folder ?? '');
  const [pending, start] = useTransition();
  const changed = (value || null) !== folder;

  return (
    <div className="space-y-1.5">
      <Label htmlFor="document-folder">{t('columns.folder')}</Label>
      <div className="flex gap-2">
        <Select id="document-folder" value={value} onChange={(e) => setValue(e.target.value)} disabled={!canEdit}>
          <option value="">{t('inbox')}</option>
          {folders.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </Select>
        {canEdit ? (
          <Button
            type="button"
            variant="outline"
            disabled={!changed || pending}
            onClick={() =>
              start(async () => {
                const s = await moveDocumentAction(documentId, value || null);
                if (s.status === 'error') toast.error(s.message);
                else if (s.status === 'success' && s.message) toast.success(s.message);
              })
            }
          >
            {t('folderSave')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
