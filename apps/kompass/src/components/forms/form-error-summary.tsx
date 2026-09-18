'use client';

import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { countInvalidFields } from '@/lib/form-errors';

/**
 * Der zusammenfassende Hinweis oben am Formular (Handover, „Formulare“).
 *
 * Die Meldung am Feld allein reicht nicht: In einem Formular mit Reitern steht
 * sie womöglich auf einer Fläche, die gerade niemand sieht. Hier steht, **dass**
 * etwas fehlt und wie viel — wo, sagen der Punkt am Reiter und das Feld selbst.
 */
export function FormErrorSummary({ errors }: { errors: Record<string, string> }) {
  const t = useTranslations('common');
  const count = countInvalidFields(errors);
  if (count === 0) return null;

  return (
    <p
      role="alert"
      className="mb-4 flex gap-2 rounded-md border border-error bg-error-bg p-3 text-[13px] text-ink-2"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-error" aria-hidden />
      <span className="font-semibold text-error">{t('fieldsInvalid', { count })}</span>
    </p>
  );
}

/** Der Punkt am Reiter, der sagt: Hier drin steckt einer. */
export function TabInvalidDot({ label }: { label: string }) {
  return <span className="size-[7px] rounded-full bg-error" aria-label={label} />;
}
