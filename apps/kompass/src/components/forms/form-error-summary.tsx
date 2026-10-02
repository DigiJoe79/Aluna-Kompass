'use client';

import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { invalidFields } from '@/lib/form-errors';

/**
 * Der zusammenfassende Hinweis oben am Formular (Handover, „Formulare“).
 *
 * Die Meldung am Feld allein reicht nicht: In einem Formular mit Reitern steht
 * sie womöglich auf einer Fläche, die gerade niemand sieht — oder das Feld hat
 * gar keinen Platz für eine Meldung. Deshalb nennt die Box jedes betroffene
 * Feld mit seiner Meldung („Fotos: Höchstens 12 Einträge.“), statt pauschal
 * „braucht noch eine Angabe“ zu sagen (Befund 6, 0.2.4: Beim 13. Foto fehlte
 * nichts, es war eines zu viel).
 *
 * `labels`: die Feldnamen des Formulars, je Schlüssel des Fehlers — ein
 * Sprachfeld unter seinem Rumpf (`summary`, nicht `summary.de`). Fehlt ein
 * Name, steht „Ein Feld“ da, nie der technische Schlüssel.
 */
export function FormErrorSummary({ errors, labels }: { errors: Record<string, string>; labels: Record<string, string> }) {
  const t = useTranslations('common');
  const fields = invalidFields(errors, labels);
  if (fields.length === 0) return null;

  return (
    <div
      role="alert"
      className="mb-4 flex gap-2 rounded-md border border-error bg-error-bg p-3 text-[13px] text-ink-2"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-error" aria-hidden />
      <div className="flex flex-col gap-1">
        <span className="font-semibold text-error">{t('fieldsInvalid', { count: fields.length })}</span>
        <ul className="flex flex-col gap-0.5">
          {fields.map((field) => (
            <li key={field.key}>{t('fieldInvalid', { field: field.label ?? t('fieldUnnamed'), message: field.messages.join(' ') })}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Der Punkt am Reiter, der sagt: Hier drin steckt einer. */
export function TabInvalidDot({ label }: { label: string }) {
  return <span className="size-[7px] rounded-full bg-error" aria-label={label} />;
}
