'use client';

import type { MeetingContext } from '@kompass/module-governance';
import { useTranslations } from 'next-intl';
import { FixedValue } from '@/components/fixed-value';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { Select } from '@/components/ui/select';
import type { DetailsOptions } from '../../../resolution-details-fields';

export type PersonKind = 'dismissal' | 'honoraryMember';
export const isPersonKind = (kind: string): kind is PersonKind => kind === 'dismissal' || kind === 'honoraryMember';
export type PersonDraft = { termId: string; membershipId: string; typeId: string };

/** Angaben → Entwurf (leer, wenn noch keine). */
export function personDraft(details: unknown): PersonDraft {
  const d = (details ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return { termId: str(d.termId), membershipId: str(d.membershipId), typeId: str(d.typeId) };
}

/** Entwurf → Angaben der Art; `null`, solange etwas fehlt (dann warnt der Dienst mit `detailsMissing`). */
export function personDetails(kind: PersonKind, d: PersonDraft): { termId: string } | { membershipId: string; typeId: string } | null {
  if (kind === 'dismissal') return d.termId ? { termId: d.termId } : null;
  return d.membershipId && d.typeId ? { membershipId: d.membershipId, typeId: d.typeId } : null;
}

/**
 * Wen der Beschluss betrifft (G-3), nach dem Vorbild des Auftrags (`MandateFields`): bei der Abberufung die am
 * Sitzungstag laufende Amtszeit, beim Ehrenmitglied Mitglied und künftige Mitgliedsart. Ohne Auswahl bleibt die
 * Warnung des Dienstes stehen; gesperrt wird nichts.
 */
export function PersonFields({ id, kind, context, options, draft, readOnly, onChange }: { id: string; kind: PersonKind; context: MeetingContext; options: Pick<DetailsOptions, 'members' | 'memberTypes'>; draft: PersonDraft; readOnly: boolean; onChange: (next: PersonDraft) => void }) {
  const t = useTranslations('governance.details');
  if (kind === 'dismissal') {
    const office = (officeId: string) => context.offices.find((o) => o.id === officeId)?.name ?? '';
    return (
      <FormGrid>
        <FormField id={`person-term-${id}`} label={t('term')}>
          <Select id={`person-term-${id}`} value={draft.termId} disabled={readOnly} onChange={(e) => onChange({ ...draft, termId: e.target.value })}>
            <option value="">{t('choose')}</option>
            {context.terms.map((term) => (
              <option key={term.id} value={term.id}>{t('termOption', { name: context.names[term.contactId] ?? '', office: office(term.officeId) })}</option>
            ))}
          </Select>
        </FormField>
      </FormGrid>
    );
  }
  return (
    <FormGrid>
      {options.members ? (
        <FormField id={`person-member-${id}`} label={t('member')}>
          <Select id={`person-member-${id}`} value={draft.membershipId} disabled={readOnly} onChange={(e) => onChange({ ...draft, membershipId: e.target.value })}>
            <option value="">{t('choose')}</option>
            {options.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        </FormField>
      ) : (
        <FixedValue id={`person-member-${id}`} label={t('member')} value={null} reason={t('memberNoRight')} />
      )}
      {options.memberTypes ? (
        <FormField id={`person-type-${id}`} label={t('memberType')}>
          <Select id={`person-type-${id}`} value={draft.typeId} disabled={readOnly} onChange={(e) => onChange({ ...draft, typeId: e.target.value })}>
            <option value="">{t('choose')}</option>
            {options.memberTypes.map((ty) => <option key={ty.id} value={ty.id}>{ty.name}</option>)}
          </Select>
        </FormField>
      ) : null}
    </FormGrid>
  );
}
