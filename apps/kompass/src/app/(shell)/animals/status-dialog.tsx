'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { setAnimalStatusAction } from './actions';
import { Select } from '@/components/ui/select';

/** `triggerVariant`: auf der Hinweisseite steht der Knopf gleichrangig neben „Von der Webseite nehmen“ (`outline`). */
export function StatusDialog({ animalId, current, triggerVariant = 'secondary' }: { animalId: string; current: string; triggerVariant?: 'secondary' | 'outline' }) {
  const t = useTranslations('animals.status');
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(current);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [pending, start] = useTransition();
  const feedback = useActionFeedback();
  const resetFeedback = feedback.reset;
  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) resetFeedback(); }}>
      <DialogTrigger render={<Button variant={triggerVariant}>{t('change')}</Button>} />
      <DialogContent size="sm" className="bg-surface shadow-md">
        <DialogTitle>{t('title')}</DialogTitle>
        <FormGrid>
          <FormField id="status" label={t('next')} size="s">
            <Select id="status" aria-label={t('next')} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="lookingForHome">{t('values.lookingForHome')}</option>
              <option value="reserved">{t('values.reserved')}</option>
              <option value="adopted">{t('values.adopted')}</option>
            </Select>
          </FormField>
          {status === 'adopted' ? (
            <FormField id="year" label={t('year')} hint={t('yearHint')} size="s">
              <Input id="year" type="number" value={year} onChange={(e) => setYear(e.target.value)} className="font-mono" />
            </FormField>
          ) : null}
        </FormGrid>
        <FormActionBar
          placement="dialog"
          cancel={() => {
            setOpen(false);
            resetFeedback();
          }}
          pending={pending}
          saveLabel={t('submit')}
          state={feedback.state}
          onSave={() =>
            start(async () => {
              const s = await feedback.run(() => setAnimalStatusAction(animalId, status, status === 'adopted' ? Number(year) : undefined));
              if (s.status === 'success') setOpen(false);
            })
          }
        />
      </DialogContent>
    </Dialog>
  );
}
