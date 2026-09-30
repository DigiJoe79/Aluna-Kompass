'use client';

import { useTranslations } from 'next-intl';
import { useDateFormat } from '@/components/date-format-provider';

/**
 * Das Band über den Reitern, solange eine Prüfung offen ist: seit wann, die
 * Notiz des Anfordernden, und bei einem unveröffentlichten Tier die Wahl,
 * beim Bestätigen gleich zu veröffentlichen.
 *
 * Der Haken ist ein natives Feld mit `form`-Attribut: Das Band steht außerhalb
 * des Formulars, das Feld reist trotzdem mit dessen Speichern. Der
 * `Checkbox`-Baustein ist ein Knopf und kennt kein `form`.
 */
export function ReviewBand({ requestedAt, note, canPublish, formId }: { requestedAt: string; note: string; canPublish: boolean; formId: string }) {
  const t = useTranslations('animals.review');
  const dates = useDateFormat();
  return (
    <div role="note" data-testid="animal-review-band" className="flex flex-col gap-2 rounded-lg border border-warning bg-warning-bg px-4 py-3 text-[13px] text-ink-2">
      <p className="font-semibold text-ink">{t('pendingSince', { date: dates.date(requestedAt) })}</p>
      {note ? <p className="whitespace-pre-line">{note}</p> : null}
      {canPublish ? (
        <div className="flex items-center gap-2">
          <input type="checkbox" id="publishOnConfirm" name="publishOnConfirm" form={formId} defaultChecked className="size-4 rounded border-line" />
          <label htmlFor="publishOnConfirm">{t('publishOnConfirm')}</label>
        </div>
      ) : null}
    </div>
  );
}
