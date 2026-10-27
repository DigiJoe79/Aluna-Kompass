'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { RemarkDialog, type RemarkTarget } from './remark-dialog';

export interface RemarkWriterProps {
  fiscalYearId: string;
  target: RemarkTarget;
  me: string;
  paperAuditors: { id: string; name: string }[];
  /** Wer Fragen beantwortet (Kontaktrolle Schatzmeister), für den Satz zur Art (281). */
  treasurerName?: string | null;
}

/** „Vermerk schreiben …“ als `outline`-Knopf eines Abschnitts (Board 4c) mit seinem Dialog. */
export function RemarkWriter(props: RemarkWriterProps) {
  const t = useTranslations('finance.audit.remarks');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button ref={ref} type="button" variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="remark-write">
        {t('write')}
      </Button>
      <RemarkDialog open={open} onOpenChange={setOpen} finalFocus={ref} {...props} />
    </>
  );
}
