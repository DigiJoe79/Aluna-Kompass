'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { toastNetwork, toastRefusal } from '@/lib/feedback';
import { setSampleAction } from '../actions';

/**
 * Stichprobe als Wert am Platz `select` (N4, Freigabe Joe 2026-10-24): ein Kästchen, das sofort speichert. Nach einer
 * Änderung an der Buchung steht es leer („erneut prüfen“ steht in der Statusspalte). Eine Ablehnung geht über
 * `toastRefusal` — in der Zeile ist kein Platz über dem Auslöser (MUSTER § A); das Kästchen springt zurück.
 */
export function SampleCheckbox({ id, fiscalYearId, entryId, checked, label, fixed = false }: { id?: string; fiscalYearId: string; entryId: string; checked: boolean; label: string; /** Prüfbericht abgelegt: das Kästchen steht fest (Designer Runde 7, 274/279). */ fixed?: boolean }) {
  const t = useTranslations('common');
  const router = useRouter();
  const [value, setValue] = useState(checked);
  const [pending, setPending] = useState(false);
  const change = async (next: boolean) => {
    setValue(next);
    setPending(true);
    try {
      const result = await setSampleAction({ fiscalYearId, entryId, sampled: next });
      if (result.status === 'error') {
        setValue(!next);
        toastRefusal(result);
        return;
      }
      router.refresh();
    } catch {
      setValue(!next);
      toastNetwork({ status: 'error', kind: 'network', message: t('network'), fieldErrors: {} }, t('retry'), () => void change(next));
    } finally {
      setPending(false);
    }
  };
  return <Checkbox id={id} aria-label={label} checked={value} disabled={pending || fixed} onCheckedChange={(next) => void change(Boolean(next))} />;
}
