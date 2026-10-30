'use client';

import type { MeetingContext } from '@kompass/module-governance';
import { useTranslations } from 'next-intl';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { Notice } from '@/components/notice';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

export type MandateDraft = { recipient: string; dueOn: string; task: string };

/** Die Angaben eines Auftrags als `mandateDetailsSchema` — `null`, solange etwas fehlt. */
export function mandateDetails(d: MandateDraft): { organId: string | null; officeId: string | null; dueOn: string; task: string } | null {
  const [type, id] = d.recipient.split(':');
  if (!id || !d.dueOn || !d.task.trim()) return null;
  return { organId: type === 'organ' ? id : null, officeId: type === 'office' ? id : null, dueOn: d.dueOn, task: d.task.trim() };
}

/**
 * Auftrag (Spec § 5.4/§ 6, Plan U1 Task 10): Empfänger (Organ oder Amt), „Fällig am“ und Aufgabe über der
 * Ergebnis-Karte; daraus wird beim Festschreiben eine Wiedervorlage. Fehlt etwas, sagt ein Hinweis, was dann fehlt.
 */
export function MandateFields({ id, context, draft, readOnly, onChange }: { id: string; context: MeetingContext; draft: MandateDraft; readOnly: boolean; onChange: (next: MandateDraft) => void }) {
  const t = useTranslations('governance.live.mandate');
  return (
    <div className="flex flex-col gap-3">
      <FormGrid>
        <FormField id={`mandate-recipient-${id}`} label={t('recipient')}>
          <Select id={`mandate-recipient-${id}`} value={draft.recipient} disabled={readOnly} onChange={(e) => onChange({ ...draft, recipient: e.target.value })}>
            <option value="">{t('choose')}</option>
            <option value={`organ:${context.organ.id}`}>{t('organ', { name: context.organ.name })}</option>
            {context.offices.map((o) => (
              <option key={o.id} value={`office:${o.id}`}>{o.name}</option>
            ))}
          </Select>
        </FormField>
        <FormField id={`mandate-due-${id}`} label={t('dueOn')} size="s">
          <Input id={`mandate-due-${id}`} type="date" value={draft.dueOn} disabled={readOnly} onChange={(e) => onChange({ ...draft, dueOn: e.target.value })} />
        </FormField>
        <FormField id={`mandate-task-${id}`} label={t('task')} size="full">
          <Textarea id={`mandate-task-${id}`} rows={2} value={draft.task} disabled={readOnly} onChange={(e) => onChange({ ...draft, task: e.target.value })} />
        </FormField>
      </FormGrid>
      {mandateDetails(draft) ? null : <Notice level="warn">{t('missing')}</Notice>}
    </div>
  );
}
