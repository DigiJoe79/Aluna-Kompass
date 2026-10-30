'use client';

import { useTranslations } from 'next-intl';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import { FixedValue } from '@/components/fixed-value';
import { AmountField } from '@/components/finance/amount-field';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { Notice } from '@/components/notice';
import { Overline } from '@/components/overline';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { DetailsDraft, DetailsKind } from '@/lib/governance/resolution-details';

export interface DetailsOptions {
  organs: { id: string; name: string }[];
  offices: { id: string; name: string; organId: string }[];
  fiscalYears: { id: string; designation: string }[];
  /** `null` ohne Recht `members.read`. */
  members: { id: string; name: string }[] | null;
  /** Mitgliedsarten (Ehrenmitglied, G-3); `null` ohne Recht `members.read`. */
  memberTypes: { id: string; name: string }[] | null;
  canPickDocuments: boolean;
  /** Je Organ mit der Regel `remuneration` im Satzungsstand des Beschlusstags das beschließende Organ (W-4, L-1, `remunerationDeciders`). */
  remunerationDeciders: Record<string, string>;
}

/**
 * Angaben der strukturierten Beschlussarten (Plan U2 Task 12), geteilt von Mitlauf und Umlauf: Vergütung,
 * Aufwendungsersatz, Rücklage, Ausschluss. Gesteuert; Hinweise sperren nie.
 */
export function ResolutionDetailsFields<K extends DetailsKind>({ id, kind, organId, draft, onChange, options, decidedOn, readOnly = false }: { id: string; kind: K; /** das beschließende Organ */ organId: string; draft: DetailsDraft[K]; onChange: (next: DetailsDraft[K]) => void; options: DetailsOptions; decidedOn: string | null; readOnly?: boolean }) {
  const t = useTranslations('governance.details');
  const set = (patch: Record<string, unknown>) => onChange({ ...draft, ...patch } as DetailsDraft[K]);
  if (kind === 'remuneration') {
    const d = draft as DetailsDraft['remuneration'];
    // W-4: dieselbe Bedingung wie der Dienst (`remunerationWithoutStatute`) — keins der beteiligten Organe hat die Regel
    // `remuneration` im am Tag gültigen Stand; ein eingetragener Verweis ersetzt sie nicht.
    const involved = [organId, d.decidedByOrganId, ...d.officeIds.map((officeId) => options.offices.find((o) => o.id === officeId)?.organId)];
    const ruled = [...new Set(involved.filter((o): o is string => !!o && o in options.remunerationDeciders))];
    const withoutStatute = ruled.length === 0;
    // L-1: dieselbe Bedingung wie der Dienst (`remunerationWrongOrgan`) — keine der Regeln nennt das beschließende Organ.
    const wrongOrgan = !withoutStatute && !ruled.some((o) => options.remunerationDeciders[o] === organId);
    return (
      <div className="flex flex-col gap-3">
        <FormGrid>
          <FormField id={`${id}-ref`} label={t('statuteReference')}>
            <Input id={`${id}-ref`} value={d.statuteReference} disabled={readOnly} onChange={(e) => set({ statuteReference: e.target.value })} />
          </FormField>
          <FormField id={`${id}-by`} label={t('decidedBy')}>
            <Select id={`${id}-by`} value={d.decidedByOrganId} disabled={readOnly} onChange={(e) => set({ decidedByOrganId: e.target.value })}>
              <option value="">{t('choose')}</option>
              {options.organs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
          </FormField>
          <FormCell size="full" as="fieldset">
            <Overline field as="div">{t('offices')}</Overline>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
              {options.offices.map((o) => (
                <label key={o.id} htmlFor={`${id}-office-${o.id}`} className="inline-flex items-center gap-2 text-body">
                  <Checkbox id={`${id}-office-${o.id}`} disabled={readOnly} checked={d.officeIds.includes(o.id)} onCheckedChange={(c) => set({ officeIds: c ? [...d.officeIds, o.id] : d.officeIds.filter((x) => x !== o.id) })} />
                  {o.name}
                </label>
              ))}
            </div>
          </FormCell>
          <FormField id={`${id}-mode`} label={t('mode')}>
            <Segmented<'flat' | 'activity'> className="self-start" aria-label={t('mode')} value={d.mode} disabled={readOnly} onValueChange={(v) => set({ mode: v })} options={[{ value: 'flat', label: t('modes.flat') }, { value: 'activity', label: t('modes.activity') }]} />
          </FormField>
          <FormField id={`${id}-amount`} label={t('amount')} size="s">
            <AmountField id={`${id}-amount`} name="amount" value={d.amount} disabled={readOnly} onChange={(amount) => set({ amount })} />
          </FormField>
          <FormField id={`${id}-from`} label={t('validFrom')} size="s">
            <Input id={`${id}-from`} type="date" value={d.validFrom} disabled={readOnly} onChange={(e) => set({ validFrom: e.target.value })} />
          </FormField>
        </FormGrid>
        {withoutStatute ? <Notice level="warn" testId="details-remuneration-without-statute">{t('remunerationWithoutStatute')}</Notice> : null}
        {wrongOrgan ? <Notice level="warn" testId="details-remuneration-wrong-organ">{t('remunerationWrongOrgan')}</Notice> : null}
      </div>
    );
  }
  if (kind === 'expenseRule') {
    const d = draft as DetailsDraft['expenseRule'];
    return (
      <div className="flex flex-col gap-3">
        <FormGrid>
          <FormField id={`${id}-basis`} label={t('basis')}>
            <Select id={`${id}-basis`} value={d.basis} disabled={readOnly} onChange={(e) => set({ basis: e.target.value })}>
              {(['statute', 'contract', 'boardResolution'] as const).map((b) => <option key={b} value={b}>{t(`bases.${b}`)}</option>)}
            </Select>
          </FormField>
          <FormField id={`${id}-from`} label={t('validFrom')} size="s">
            <Input id={`${id}-from`} type="date" value={d.validFrom} disabled={readOnly} onChange={(e) => set({ validFrom: e.target.value })} />
          </FormField>
          <FormField id={`${id}-rule`} label={t('rule')} size="l">
            <Textarea id={`${id}-rule`} rows={3} value={d.rule} disabled={readOnly} onChange={(e) => set({ rule: e.target.value })} />
          </FormField>
        </FormGrid>
        {decidedOn && d.validFrom && d.validFrom < decidedOn ? <Notice level="warn">{t('expenseRuleRetroactive')}</Notice> : null}
      </div>
    );
  }
  if (kind === 'reserve') {
    const d = draft as DetailsDraft['reserve'];
    return (
      <FormGrid>
        <FormField id={`${id}-type`} label={t('reserveType')}>
          <Select id={`${id}-type`} value={d.type} disabled={readOnly} onChange={(e) => set({ type: e.target.value })}>
            {(['nr1', 'nr2', 'nr3', 'nr4'] as const).map((x) => <option key={x} value={x}>{t(`reserveTypes.${x}`)}</option>)}
          </Select>
        </FormField>
        <FormField id={`${id}-purpose`} label={t('purpose')} required={d.type === 'nr1' || d.type === 'nr2'}>
          <Input id={`${id}-purpose`} value={d.purpose} disabled={readOnly} onChange={(e) => set({ purpose: e.target.value })} />
        </FormField>
        <FormField id={`${id}-amount`} label={t('amount')} size="s">
          <AmountField id={`${id}-amount`} name="amount" value={d.amount} disabled={readOnly} onChange={(amount) => set({ amount })} />
        </FormField>
        <FormField id={`${id}-year`} label={t('fiscalYear')} size="s">
          <Select id={`${id}-year`} value={d.fiscalYearId} disabled={readOnly} onChange={(e) => set({ fiscalYearId: e.target.value })}>
            <option value="">{t('choose')}</option>
            {options.fiscalYears.map((y) => <option key={y.id} value={y.id}>{y.designation}</option>)}
          </Select>
        </FormField>
        <FormField id={`${id}-action`} label={t('movement')} size="full">
          <Segmented<'create' | 'withdraw' | 'dissolve'> className="self-start" aria-label={t('movement')} value={d.action} disabled={readOnly} onValueChange={(v) => set({ action: v })} options={(['create', 'withdraw', 'dissolve'] as const).map((x) => ({ value: x, label: t(`movements.${x}`) }))} />
        </FormField>
      </FormGrid>
    );
  }
  const d = draft as DetailsDraft['exclusion'];
  const date = (key: 'reasonsSentOn' | 'hearingOn' | 'noticeReceivedOn') => (
    <FormField id={`${id}-${key}`} label={t(key)} size="s">
      <Input id={`${id}-${key}`} type="date" value={d[key]} disabled={readOnly} onChange={(e) => set({ [key]: e.target.value })} />
    </FormField>
  );
  return (
    <FormGrid>
      {options.members ? (
        <FormField id={`${id}-member`} label={t('member')}>
          <Select id={`${id}-member`} value={d.membershipId} disabled={readOnly} onChange={(e) => set({ membershipId: e.target.value })}>
            <option value="">{t('choose')}</option>
            {options.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        </FormField>
      ) : (
        <FixedValue id={`${id}-member`} label={t('member')} value={null} reason={t('memberNoRight')} />
      )}
      <FormField id={`${id}-ground`} label={t('statuteGround')}>
        <Input id={`${id}-ground`} value={d.statuteGround} disabled={readOnly} onChange={(e) => set({ statuteGround: e.target.value })} />
      </FormField>
      {date('reasonsSentOn')}
      {date('hearingOn')}
      {date('noticeReceivedOn')}
      {options.canPickDocuments ? (
        <FormCell size="full">
          <DocumentPicker id={`${id}-reasons`} name="reasonsDocumentId" label={t('reasonsDocument')} value={d.reasonsDocumentId ? { id: d.reasonsDocumentId, number: null, subject: t('reasonsDocument'), phase: 'issued' } : null} onChange={(doc) => set({ reasonsDocumentId: doc?.id ?? '' })} />
          <p className="mt-1 text-hint text-muted-ink">{t('reasonsHint')}</p>
        </FormCell>
      ) : null}
    </FormGrid>
  );
}
