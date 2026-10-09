'use client';

import { useTranslations } from 'next-intl';
import { useDateFormat } from '@/components/date-format-provider';
import { Notice } from '@/components/notice';
import { Checkbox } from '@/components/ui/checkbox';

/** `data-dirty-ignore` gehört an das versteckte Feld, das die Speicherleiste liest — nicht an den Knopf. */
const ignoreForDirty = (input: HTMLInputElement | null) => input?.setAttribute('data-dirty-ignore', '');

/**
 * Das Band über den Reitern, solange eine Prüfung offen ist: seit wann, die
 * Notiz des Anfordernden, und bei einem unveröffentlichten Tier die Wahl,
 * beim Bestätigen gleich zu veröffentlichen.
 *
 * Der Haken trägt das `form`-Attribut: Das Band steht außerhalb des Formulars,
 * das versteckte Feld des `Checkbox`-Bausteins reist trotzdem mit dessen Speichern.
 *
 * Der Haken ändert keinen Datensatz: Die Action liest ihn nur beim Bestätigen, beim Speichern nicht. Deshalb
 * `data-dirty-ignore` – er zählt in der Speicherleiste nie als Änderung und bietet kein Speichern an.
 */
export function ReviewBand({ requestedAt, note, canPublish, formId }: { requestedAt: string; note: string; canPublish: boolean; formId: string }) {
  const t = useTranslations('animals.review');
  const dates = useDateFormat();
  return (
    <Notice level="warn" title={t('pendingSince', { date: dates.date(requestedAt) })} testId="animal-review-band">
      {note ? <p className="whitespace-pre-line">{note}</p> : null}
      {canPublish ? (
        <div className="mt-2 flex items-center gap-2">
          <Checkbox id="publishOnConfirm" name="publishOnConfirm" value="on" form={formId} defaultChecked inputRef={ignoreForDirty} />
          <label htmlFor="publishOnConfirm">{t('publishOnConfirm')}</label>
        </div>
      ) : null}
    </Notice>
  );
}
