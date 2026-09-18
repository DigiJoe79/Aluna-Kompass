'use client';

import { useDateFormat } from '@/components/date-format-provider';
import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { SubmitButton } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { idleState } from '@/lib/actions';
import { addNoteAction, deleteNoteAction } from '../actions';

export interface NoteView {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
  mine: boolean;
}

/**
 * Das Journal neben dem Dokument: Was beim Bearbeiten auffiel, ohne dass es
 * ins Blatt gehört. Notizen stehen nie im PDF, nie im Volltext, nie in einem
 * Export — und sie werden angehängt, nicht geändert.
 */
export function NotesPanel({
  documentId,
  notes,
  canEdit,
  canManage,
}: {
  documentId: string;
  notes: NoteView[];
  canEdit: boolean;
  canManage: boolean;
}) {
  const t = useTranslations('dms.notes');
  const fmt = useDateFormat();
  const [state, action] = useActionState(addNoteAction.bind(null, documentId), idleState);
  const [deleting, setDeleting] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === 'success') formRef.current?.reset();
  }, [state]);

  return (
    <section data-testid="notes-panel" className="mt-6 rounded-md border border-line bg-surface p-5 shadow-xs">
      <h3 className="mb-1 text-[15px] font-semibold text-ink">{t('title')}</h3>
      <p className="mb-4 text-[12px] text-muted-ink">{t('hint')}</p>

      {notes.length === 0 ? (
        <p className="text-[13px] text-muted-ink">{t('none')}</p>
      ) : (
        <ul className="space-y-3 text-[13px]">
          {notes.map((note) => (
            <li key={note.id} className="flex items-start gap-3 border-b border-line-2 pb-3 last:border-b-0 last:pb-0">
              <div className="flex-1">
                <p className="text-muted-ink">
                  {note.authorName} · {fmt.dateTime(note.createdAt)}
                </p>
                <p className="whitespace-pre-line text-ink-2">{note.body}</p>
              </div>
              {note.mine || canManage ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t('delete')}
                  onClick={() => setDeleting(note.id)}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <form ref={formRef} action={action} className="mt-4 space-y-2">
          <Textarea name="body" aria-label={t('add')} rows={3} required />
          {state.status === 'error' ? (
            <p role="alert" className="text-[13px] text-error">
              {state.message}
            </p>
          ) : null}
          <SubmitButton size="sm">{t('submit')}</SubmitButton>
        </form>
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => setDeleting(open ? deleting : null)}
        title={t('deleteTitle')}
        description={t('deleteDescription')}
        confirmLabel={t('deleteConfirm')}
        destructive
        action={() => deleteNoteAction(documentId, deleting ?? '')}
      />
    </section>
  );
}
