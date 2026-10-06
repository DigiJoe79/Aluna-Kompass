'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { markNotReturnAction } from '../actions';

/**
 * AC: Eine Auszahlung an eine Person, die auch gespendet hat, sperrt deren
 * Bestätigung als möglicher Rückläufer — außer sie ist ausdrücklich keine
 * Rückgabe (Erstattung, Honorar). Mit Begründung; aufheben geht jederzeit.
 */
export function NotReturnCard({ entryId, mark, canMark }: { entryId: string; mark: { note: string } | null; canMark: boolean }) {
  const t = useTranslations('finance.entryView.notReturn');
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  return (
    <section data-testid="entry-not-return" className="space-y-2 rounded-md border border-line bg-surface p-4">
      <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-ink">{t('title')}</h3>
      <p className="text-[13px] text-ink-2">{mark ? t('marked', { note: mark.note }) : t('text')}</p>
      {canMark ? (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          {mark ? t('lift') : t('mark')}
        </Button>
      ) : null}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        role="dialog"
        title={mark ? t('liftTitle') : t('markTitle')}
        description={mark ? t('liftText') : t('markText')}
        confirmLabel={mark ? t('lift') : t('mark')}
        confirmDisabled={!mark && note.trim() === ''}
        action={() => markNotReturnAction({ entryId, notReturn: !mark, ...(mark ? {} : { note }) })}
      >
        {mark ? null : (
          <FormGrid>
            <FormField id="not-return-note" label={t('note')} size="l">
              <Textarea id="not-return-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
            </FormField>
          </FormGrid>
        )}
      </ConfirmDialog>
    </section>
  );
}
