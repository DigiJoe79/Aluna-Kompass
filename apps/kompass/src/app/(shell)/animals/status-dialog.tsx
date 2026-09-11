'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/forms/form-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { setAnimalStatusAction } from './actions';
import { Select } from '@/components/ui/select';

export function StatusDialog({ animalId, current }: { animalId: string; current: string }) {
  const t = useTranslations('animals.status');
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(current);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="secondary">{t('change')}</Button>} />
      <DialogContent className="bg-surface shadow-md">
        <DialogTitle className="font-heading text-[19px]">{t('title')}</DialogTitle>
        <FormField id="status" label={t('next')}>
          <Select id="status" aria-label={t('next')} value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto">
            <option value="lookingForHome">{t('values.lookingForHome')}</option>
            <option value="reserved">{t('values.reserved')}</option>
            <option value="adopted">{t('values.adopted')}</option>
          </Select>
        </FormField>
        {status === 'adopted' ? (
          <FormField id="year" label={t('year')} hint={t('yearHint')}>
            <Input id="year" type="number" value={year} onChange={(e) => setYear(e.target.value)} className="font-mono" />
          </FormField>
        ) : null}
        <DialogFooter>
          <Button disabled={pending} onClick={() => start(async () => {
            const s = await setAnimalStatusAction(animalId, status, status === 'adopted' ? Number(year) : undefined);
            if (s.status === 'error') toast.error(s.message);
            else {
              toast.success(s.status === 'success' ? s.message ?? '' : '');
              setOpen(false);
            }
          })}>
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
