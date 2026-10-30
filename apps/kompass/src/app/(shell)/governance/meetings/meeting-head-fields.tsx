'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ContactPicker, type PickedContact } from '@/components/contact-picker';
import { FixedValue } from '@/components/fixed-value';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

type Form = 'inPerson' | 'hybrid' | 'virtual';
const ASSEMBLY_KINDS = ['ordinary', 'extraordinary', 'repeat', 'founding'] as const;

export interface MeetingHeadDefaults {
  organId: string;
  kind: string;
  heldOn: string;
  startsAt: string;
  form: Form;
  place: string | null;
  access: string | null;
  remoteNote: string | null;
  repeatOfId: string | null;
}

export interface MeetingHeadFieldsProps {
  organs: { id: string; name: string; kind: string }[];
  /** Beim Ändern: der Stand; beim Anlegen `null`. */
  meeting: MeetingHeadDefaults | null;
  /** Vorbelegtes Organ beim Anlegen (`?organ=`). */
  presetOrganId?: string;
  /** Ziel der Warnkachel (`?kind=ordinary`, Plan U2 Task 15). */
  presetKind?: string;
  /** Sitzungen, die eine Wiederholung wiederholen kann (gleiches Organ). */
  repeatCandidates: { id: string; organId: string; label: string }[];
  /** Ohne `contacts.view` steht die Besetzung als fester Wert. */
  canPickContacts: boolean;
  chair: PickedContact | null;
  minuteTaker: PickedContact | null;
  errors: Record<string, string>;
}

/**
 * Die Kopffelder einer Sitzung (Plan U1 Task 4, Spec § 5.2) — ungesteuert in einem `ActionForm`, nur Organ, Art und
 * Form halten Zustand, weil andere Felder davon abhängen. Das Organ ist nach dem Anlegen fest.
 */
export function MeetingHeadFields({ organs, meeting, presetOrganId, presetKind, repeatCandidates, canPickContacts, chair: initialChair, minuteTaker: initialMinuteTaker, errors }: MeetingHeadFieldsProps) {
  const t = useTranslations('governance.head');
  const tk = useTranslations('governance.meetings.kinds');
  const tf = useTranslations('governance.meetings.forms');
  const [organId, setOrganId] = useState(meeting?.organId ?? presetOrganId ?? organs.find((o) => o.kind === 'assembly')?.id ?? organs[0]?.id ?? '');
  const assembly = organs.find((o) => o.id === organId)?.kind === 'assembly';
  const kinds = assembly ? ASSEMBLY_KINDS : (['board'] as const);
  const [kind, setKind] = useState<string>(meeting?.kind ?? presetKind ?? kinds[0]);
  const shownKind = (kinds as readonly string[]).includes(kind) ? kind : kinds[0];
  const [form, setForm] = useState<Form>(meeting?.form ?? 'inPerson');
  const [chair, setChair] = useState<PickedContact | null>(initialChair);
  const [minuteTaker, setMinuteTaker] = useState<PickedContact | null>(initialMinuteTaker);
  const organName = organs.find((o) => o.id === organId)?.name ?? '';

  return (
    <FormGrid>
      {meeting ? (
        <FixedValue id="meeting-organ" label={t('organ')} value={organName} reason={t('organFixed')} />
      ) : (
        <FormField id="meeting-organ" label={t('organ')} required error={errors.organId}>
          <Select id="meeting-organ" name="organId" value={organId} onChange={(e) => setOrganId(e.target.value)}>
            {organs.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </Select>
        </FormField>
      )}
      <FormField id="meeting-kind" label={t('kind')} required error={errors.kind}>
        <Select id="meeting-kind" name="kind" value={shownKind} onChange={(e) => setKind(e.target.value)}>
          {kinds.map((k) => (
            <option key={k} value={k}>{tk(k)}</option>
          ))}
        </Select>
      </FormField>
      {shownKind === 'repeat' ? (
        <FormField id="meeting-repeat" label={t('repeatOf')} required error={errors.repeatOfId}>
          <Select id="meeting-repeat" name="repeatOfId" defaultValue={meeting?.repeatOfId ?? ''}>
            <option value="">{t('repeatOfNone')}</option>
            {repeatCandidates.filter((c) => c.organId === organId).map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </Select>
        </FormField>
      ) : null}
      <FormField id="meeting-date" label={t('heldOn')} required size="s" error={errors.heldOn}>
        <Input id="meeting-date" name="heldOn" type="date" defaultValue={meeting?.heldOn ?? ''} />
      </FormField>
      <FormField id="meeting-time" label={t('startsAt')} required size="s" error={errors.startsAt}>
        <Input id="meeting-time" name="startsAt" type="time" defaultValue={meeting?.startsAt ?? '19:00'} />
      </FormField>
      <FormField id="meeting-form" label={t('form')} error={errors.form}>
        <Segmented
          className="self-start"
          aria-label={t('form')}
          name="form"
          value={form}
          onValueChange={setForm}
          options={(['inPerson', 'hybrid', 'virtual'] as const).map((value) => ({ value, label: tf(value) }))}
        />
      </FormField>
      <FormField id="meeting-place" label={t('place')} error={errors.place}>
        <Input id="meeting-place" name="place" defaultValue={meeting?.place ?? ''} />
      </FormField>
      {form !== 'inPerson' ? (
        <>
          <FormField id="meeting-access" label={t('access')} hint={t('accessHint')} error={errors.access}>
            <Input id="meeting-access" name="access" defaultValue={meeting?.access ?? ''} />
          </FormField>
          <FormField id="meeting-remote" label={t('remoteNote')} hint={t('remoteNoteHint')} size="l" error={errors.remoteNote}>
            <Textarea id="meeting-remote" name="remoteNote" rows={3} defaultValue={meeting?.remoteNote ?? ''} />
          </FormField>
        </>
      ) : null}
      {canPickContacts ? (
        <>
          <ContactPicker id="meeting-chair" name="plannedChairContactId" label={t('chair')} value={chair} onChange={setChair} kind="person" role="member" />
          <ContactPicker id="meeting-minute-taker" name="plannedMinuteTakerContactId" label={t('minuteTaker')} value={minuteTaker} onChange={setMinuteTaker} kind="person" role="member" />
        </>
      ) : (
        <>
          <FixedValue id="meeting-chair" label={t('chair')} value={initialChair?.name ?? null} reason={t('contactsFixed')} />
          <FixedValue id="meeting-minute-taker" label={t('minuteTaker')} value={initialMinuteTaker?.name ?? null} reason={t('contactsFixed')} />
        </>
      )}
    </FormGrid>
  );
}
