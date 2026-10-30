'use client';

import type { AttendanceView, FindingsView } from '@kompass/module-governance';
import { useTranslations } from 'next-intl';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { Notice } from '@/components/notice';
import { Section } from '@/components/section';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

export type FindingsDraft = {
  chairContactId: string | null;
  minuteTakerContactId: string | null;
  chairBy: 'statute' | 'elected' | 'consent' | null;
  invitationProper: boolean | null;
  invitationNote: string;
  quorate: boolean | null;
  quorumNote: string;
  agendaApproved: boolean | null;
};

/** Ob eine Feststellung vom Vorschlag abweicht und noch ohne Begründung ist — dann wartet sie im Browser. */
export function findingsComplete(d: FindingsDraft, suggested: FindingsView['suggested']): boolean {
  const against = (found: boolean | null, s: boolean | null) => found !== null && s !== null && found !== s;
  if (against(d.invitationProper, suggested.invitationProper) && !d.invitationNote.trim()) return false;
  if (against(d.quorate, suggested.quorum.met) && !d.quorumNote.trim()) return false;
  return true;
}

/**
 * Feststellungen zu Beginn (Spec § 5.4, Plan U1 Entscheidung 5 — nicht auf dem Board, aus vorhandenen Bausteinen):
 * Leitung und Protokollführung aus der Anwesenheit, wie bestimmt, ordnungsgemäß eingeladen und beschlussfähig mit dem
 * Vorschlag von Kompass, Tagesordnung genehmigt. Weicht eine Feststellung vom Vorschlag ab, verlangt sie eine
 * Begründung; bis dahin geht sie nicht hinaus.
 */
export function FindingsCard({ draft, suggested, attendance, names, readOnly, onChange }: { draft: FindingsDraft; suggested: FindingsView['suggested']; attendance: AttendanceView[]; names: Record<string, string>; readOnly: boolean; onChange: (next: FindingsDraft) => void }) {
  const t = useTranslations('governance.live.findings');
  const people = attendance.filter((a) => !a.guest && a.contactId).map((a) => ({ id: a.contactId!, name: names[a.contactId!] ?? '' }));
  const yesNo = [
    { value: 'yes' as const, label: t('yes') },
    { value: 'no' as const, label: t('no') },
  ];
  const asValue = (b: boolean | null) => (b === null ? undefined : b ? ('yes' as const) : ('no' as const));
  const suggestion = (b: boolean | null) => (b === null ? undefined : t('suggested', { value: b ? t('yes') : t('no') }));
  const invitationAgainst = draft.invitationProper !== null && suggested.invitationProper !== null && draft.invitationProper !== suggested.invitationProper;
  const quorumAgainst = draft.quorate !== null && suggested.quorum.met !== null && draft.quorate !== suggested.quorum.met;
  const set = (patch: Partial<FindingsDraft>) => onChange({ ...draft, ...patch });
  const person = (id: string, label: string, value: string | null, key: 'chairContactId' | 'minuteTakerContactId') => (
    <FormField id={id} label={label}>
      <Select id={id} value={value ?? ''} disabled={readOnly} onChange={(e) => set({ [key]: e.target.value || null })}>
        <option value="">{t('choose')}</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </Select>
    </FormField>
  );
  return (
    <Section title={t('title')}>
      <div className="flex flex-col gap-3" data-testid="findings-card">
        <FormGrid>
          {person('findings-chair', t('chair'), draft.chairContactId, 'chairContactId')}
          {person('findings-minutes', t('minuteTaker'), draft.minuteTakerContactId, 'minuteTakerContactId')}
          <FormField id="findings-chair-by" label={t('chairBy')}>
            <Segmented className="self-start" aria-label={t('chairBy')} disabled={readOnly} value={draft.chairBy ?? undefined} onValueChange={(v) => set({ chairBy: v })} options={(['statute', 'elected', 'consent'] as const).map((v) => ({ value: v, label: t(`chairByOptions.${v}`) }))} />
          </FormField>
          <FormField id="findings-invitation" label={t('invitationProper')} hint={suggestion(suggested.invitationProper)}>
            <Segmented className="self-start" aria-label={t('invitationProper')} disabled={readOnly} value={asValue(draft.invitationProper)} onValueChange={(v) => set({ invitationProper: v === 'yes' })} options={yesNo} />
          </FormField>
          <FormField id="findings-quorate" label={t('quorate')} hint={suggestion(suggested.quorum.met)}>
            <Segmented className="self-start" aria-label={t('quorate')} disabled={readOnly} value={asValue(draft.quorate)} onValueChange={(v) => set({ quorate: v === 'yes' })} options={yesNo} />
          </FormField>
          <FormField id="findings-agenda" label={t('agendaApproved')}>
            <Segmented className="self-start" aria-label={t('agendaApproved')} disabled={readOnly} value={asValue(draft.agendaApproved)} onValueChange={(v) => set({ agendaApproved: v === 'yes' })} options={yesNo} />
          </FormField>
        </FormGrid>
        {invitationAgainst ? (
          <>
            <Notice level="warn">{t('against')}</Notice>
            <FormField id="findings-invitation-note" label={`${t('invitationProper')}: ${t('reason')}`} required size="full">
              <Textarea id="findings-invitation-note" required rows={2} disabled={readOnly} value={draft.invitationNote} onChange={(e) => set({ invitationNote: e.target.value })} />
            </FormField>
          </>
        ) : null}
        {quorumAgainst ? (
          <>
            <Notice level="warn">{t('against')}</Notice>
            <FormField id="findings-quorum-note" label={`${t('quorate')}: ${t('reason')}`} required size="full">
              <Textarea id="findings-quorum-note" required rows={2} disabled={readOnly} value={draft.quorumNote} onChange={(e) => set({ quorumNote: e.target.value })} />
            </FormField>
          </>
        ) : null}
      </div>
    </Section>
  );
}
