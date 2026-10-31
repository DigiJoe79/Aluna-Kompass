'use client';

import type { GemAnswers, TaxStatuteSuggestion } from '@kompass/module-finance';
import { gemFormFor, type GemLine } from '@kompass/module-finance/gem-forms';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, useState, type ReactNode } from 'react';
import { CountField } from '@/components/count-field';
import { useDateFormat } from '@/components/date-format-provider';
import { AmountField } from '@/components/finance/amount-field';
import { FixedValue } from '@/components/fixed-value';
import { TIGHT } from '../audit/report/subject-block';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid, FormRowBreak } from '@/components/forms/form-grid';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Notice } from '@/components/notice';
import { Overline } from '@/components/overline';
import { RowMenu } from '@/components/row-menu';
import { Section } from '@/components/section';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { formatAmount, formatEuro, readAmount, type AmountError } from '@/lib/finance/amount';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { linkTaxPeriodDocumentAction, saveTaxPeriodAnswersAction } from './actions';
import type { TaxYear } from './types';

type YesNoField = 'churchPurposes' | 'charitablePurposes' | 'welfare' | 'hospital' | 'sport' | 'gratuitousBenefits' | 'withholdingTax50a';
type Submission = 'onFile' | 'willSubmit';

/** Die Angaben in der Maske: Beträge als Text, wie man sie tippt; erst beim Speichern in Cent. */
interface Draft {
  answers: GemAnswers;
  replacement: Record<string, { asset: string; expectedCost: string; regularDepreciation: string }>;
  participations: Record<string, { company: string; taxOffice: string; taxNumber: string }>;
  gifts: { key: string; reason: string; amount: string }[];
  members: Record<string, string>;
}

export interface AnswerReserve {
  id: string;
  name: string;
}

/** Die Frage einer Zeile: „Zeile 5 · Datum der zurzeit gültigen Satzung“. */
const answerField = (line: GemLine): keyof GemAnswers | null => (typeof line.source === 'object' ? line.source.answer : null);

function draftOf(answers: GemAnswers, years: readonly TaxYear[], suggestions: Record<string, number> | null): Draft {
  return {
    // Das Satzungsdatum aus Gremien wird nicht vorbelegt (Joe 29.10.): Es stünde als ungespeicherte Änderung da, und
    // das Verlassen der Seite fragte nach. Es steht als Hinweis daneben, erst „Übernehmen“ setzt es.
    answers,
    replacement: Object.fromEntries(Object.entries(answers.replacementAssets ?? {}).map(([id, a]) => [id, { asset: a.asset, expectedCost: a.expectedCostCents === undefined ? '' : formatAmount(a.expectedCostCents), regularDepreciation: a.regularDepreciationCents === undefined ? '' : formatAmount(a.regularDepreciationCents) }])),
    participations: { ...(answers.participations ?? {}) },
    gifts: (answers.gratuitousBenefitList ?? []).map((g, i) => ({ key: `g${i}`, reason: g.reason, amount: formatAmount(g.amountCents) })),
    // Vorbelegt aus der Mitgliederverwaltung, solange nichts gespeichert ist (Board 15e).
    members: Object.fromEntries(years.map((y) => [y.id, String(answers.memberCounts?.[y.id] ?? suggestions?.[y.id] ?? '')])),
  };
}

/** Die Angaben, wie der Dienst sie nimmt: leere Felder fehlen, Beträge in Cent. */
function answersOf(d: Draft, replacementIds: readonly string[], participationIds: readonly string[]): GemAnswers {
  const out: GemAnswers = { ...d.answers };
  delete out.replacementAssets;
  delete out.participations;
  delete out.gratuitousBenefitList;
  delete out.memberCounts;
  // Unlesbares fehlt hier nur für Zähler und Vergleich; gespeichert wird es nie — `amountErrorsOf` hält `save` an.
  const cents = (text: string) => {
    const read = readAmount(text, { required: false });
    return read.ok && read.cents !== null ? read.cents : undefined;
  };
  const replacement = Object.fromEntries(
    Object.entries(d.replacement)
      .filter(([id, r]) => replacementIds.includes(id) || r.asset.trim())
      .filter(([, r]) => r.asset.trim() || r.expectedCost.trim() || r.regularDepreciation.trim())
      .map(([id, r]) => [id, { asset: r.asset.trim(), ...(cents(r.expectedCost) === undefined ? {} : { expectedCostCents: cents(r.expectedCost)! }), ...(cents(r.regularDepreciation) === undefined ? {} : { regularDepreciationCents: cents(r.regularDepreciation)! }) }]),
  );
  if (Object.keys(replacement).length > 0) out.replacementAssets = replacement;
  const participations = Object.fromEntries(Object.entries(d.participations).filter(([id, p]) => participationIds.includes(id) || p.company.trim()).filter(([, p]) => p.company.trim() || p.taxOffice.trim() || p.taxNumber.trim()));
  if (Object.keys(participations).length > 0) out.participations = participations;
  if (d.answers.gratuitousBenefits === true) out.gratuitousBenefitList = d.gifts.map((g) => ({ reason: g.reason, amountCents: cents(g.amount) ?? 0 }));
  const members = Object.fromEntries(Object.entries(d.members).filter(([, v]) => v.trim() !== '').map(([id, v]) => [id, Number(v)]));
  if (Object.keys(members).length > 0) out.memberCounts = members;
  for (const key of Object.keys(out) as (keyof GemAnswers)[]) if (out[key] === undefined) delete out[key];
  return out;
}

/**
 * Die Betragsfelder, die so nicht gespeichert werden (App-B6/B7): Kosten und AfA einer Wiederbeschaffungsrücklage sind
 * optional (leer fehlt), der Betrag einer unentgeltlichen Zuwendung (Zeile 75) ist Pflicht. Schlüssel ist die Feld-ID.
 */
function amountErrorsOf(d: Draft): Record<string, AmountError> {
  const errors: Record<string, AmountError> = {};
  const check = (id: string, text: string, required: boolean) => {
    const read = readAmount(text, { required });
    if (!read.ok) errors[id] = read.error;
  };
  for (const [id, r] of Object.entries(d.replacement)) {
    check(`answer-cost-${id}`, r.expectedCost, false);
    check(`answer-afa-${id}`, r.regularDepreciation, false);
  }
  if (d.answers.gratuitousBenefits === true) for (const g of d.gifts) check(`answer-gift-${g.key}-amount`, g.amount, true);
  return errors;
}

/** Je Schlüssel geändert oder nicht — der Zähler der Speicherleiste. */
function changedCount(a: GemAnswers, b: GemAnswers): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof GemAnswers>;
  return [...keys].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).length;
}

/**
 * „Ihre Angaben“ (Board 5a, 15e): nur, was Kompass nicht aus den Buchungen kennt, in einer `FormCard` mit `FormGrid`.
 * Ja/Nein als `Segmented`, Tage als Datumsfeld, Auswahl als `Select`; je Rücklage eine Untergruppe mit ihrem Namen als
 * Overline; Zeile 75 als wiederholbare Liste wie die Übergabepunkte (14c); die Mitglieder am Jahresende je Jahr,
 * vorbelegt aus der Mitgliederverwaltung. Ohne `finance.periodClose` steht alles als Text, ebenso nach der Abgabe
 * (Befund 18 c) — dann mit dem Grund über der Karte; der Dienst lehnt dort ab (`taxPeriodFiled`).
 */
export function AnswersCard({
  period,
  formYear,
  years,
  replacementReserves,
  participationReserves,
  memberSuggestions,
  canEdit,
  filed = false,
  today,
  statuteSuggestion = null,
  statuteLinked = false,
}: {
  period: { id: string; version: string; answers: GemAnswers };
  formYear: number;
  years: readonly TaxYear[];
  replacementReserves: readonly AnswerReserve[];
  participationReserves: readonly AnswerReserve[];
  /** Mitglieder am Ende je Jahr laut Mitgliederverwaltung; `null`, wenn sie aus ist oder nicht gelesen werden darf. */
  memberSuggestions: Record<string, number> | null;
  canEdit: boolean;
  /** Die Erklärung ist abgegeben: Die Angaben stehen fest, bis die Abgabe zurückgenommen ist. */
  filed?: boolean;
  /** Heute in der Zone des Vereins: Bis zum Jahresende steht die Mitgliederzahl „Stand heute“ (316). */
  today?: string;
  /** G7: „Satzung in der Fassung vom“ aus Gremien (`taxPeriodStatute`); `null` ohne Gremien. */
  statuteSuggestion?: TaxStatuteSuggestion | null;
  /** Die Satzung liegt schon als Beilage am Zeitraum — dann kein „Satzung aus Gremien verknüpfen“. */
  statuteLinked?: boolean;
}) {
  const t = useTranslations('finance.tax.answers');
  const editable = canEdit && !filed;
  const readOnlyReason = filed ? t('filedReason') : t('readOnly');
  // Abgegeben: der Grund steht einmal als Hinweis über der Karte, die Felder als dichte Wertliste (Designer Runde 7, 318).
  const fixedProps = filed ? { describedBy: 'tax-answers-filed-text', className: TIGHT } : { reason: readOnlyReason };
  const fmt = useDateFormat();
  const router = useRouter();
  const form = gemFormFor(formYear);
  const lines = (form?.lines ?? []).filter((l) => answerField(l) !== null && l.kind !== 'elster');
  const replacementIds = replacementReserves.map((r) => r.id);
  const participationIds = participationReserves.map((r) => r.id);
  const initialDraft = draftOf(period.answers, years, memberSuggestions);
  const [baseline, setBaseline] = useState(() => answersOf(initialDraft, replacementIds, participationIds));
  const statuteLink = useActionFeedback();
  const [d, setD] = useState<Draft>(initialDraft);
  const [pending, setPending] = useState(false);
  const [amountErrors, setAmountErrors] = useState<Record<string, AmountError>>({});
  const tAmount = useTranslations('finance.amount');
  const amountError = (id: string) => (amountErrors[id] === 'missing' ? tAmount('missing') : undefined);
  const clearAmountError = (id: string) => setAmountErrors(({ [id]: _typed, ...rest }) => rest);
  const feedback = useActionFeedback();
  const current = answersOf(d, replacementIds, participationIds);
  const changed = changedCount(current, baseline);
  const a = d.answers;
  const set = (patch: Partial<GemAnswers>) => setD((s) => ({ ...s, answers: { ...s.answers, ...patch } }));

  const save = async () => {
    const errors = amountErrorsOf(d);
    setAmountErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setPending(true);
    const result = await feedback.run(() => saveTaxPeriodAnswersAction({ id: period.id, answers: current, expectedVersion: period.version }), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    setBaseline(current);
    router.refresh();
  };

  const label = (line: GemLine) => t('lineLabel', { line: line.line, label: line.label });
  const yesNoText = (v: boolean | undefined) => (v === undefined ? null : v ? t('yes') : t('no'));
  const choiceText = (v: Submission | undefined) => (v ? t(`submission.${v}`) : null);

  const lineField = (line: GemLine): ReactNode => {
    const field = answerField(line)!;
    const id = `answer-${field}`;
    if (field === 'gratuitousBenefitList') return null;
    if (field === 'feeResolutionSubmission' && typeof a.feeResolution !== 'object') return null;
    if (!editable) {
      const value =
        line.kind === 'yesNo'
          ? yesNoText(a[field as YesNoField])
          : field === 'feeResolution'
            ? a.feeResolution === 'none'
              ? t('noFeeResolution')
              : a.feeResolution
                ? fmt.date(a.feeResolution.date)
                : null
            : line.kind === 'date'
              ? (a.statuteDate ? fmt.date(a.statuteDate) : null)
              : choiceText(a[field as 'statuteSubmission' | 'feeResolutionSubmission']);
      return <FixedValue key={field} id={id} label={label(line)} value={value} {...fixedProps} size="m" />;
    }
    if (line.kind === 'yesNo') {
      const value = a[field as YesNoField];
      return (
        <FormField key={field} id={id} label={label(line)} required={line.required} hint={value === true && line.help ? line.help : undefined} size="m">
          <div id={id}>
            <Segmented
              aria-label={label(line)}
              value={value === undefined ? undefined : value ? 'yes' : 'no'}
              onValueChange={(v) => set({ [field]: v === 'yes' } as Partial<GemAnswers>)}
              testId={`answer-${field}-segmented`}
              options={[
                { value: 'yes', label: t('yes'), testId: `answer-${field}-yes` },
                { value: 'no', label: t('no'), testId: `answer-${field}-no` },
              ]}
            />
          </div>
        </FormField>
      );
    }
    if (field === 'statuteDate') {
      // Übernommen, aber noch nicht gespeichert: der Rahmen des Vorschlags (MUSTER § E), bis gespeichert oder geändert.
      const taken = !!statuteSuggestion && a.statuteDate === statuteSuggestion.date && baseline.statuteDate !== statuteSuggestion.date;
      const input = <Input id={id} type="date" value={a.statuteDate ?? ''} onChange={(e) => set({ statuteDate: e.target.value || undefined })} className={taken ? 'border-agent' : undefined} />;
      if (!statuteSuggestion) {
        return (
          <FormField key={field} id={id} label={label(line)} required={line.required} size="m">
            {input}
          </FormField>
        );
      }
      // G7: der Vorschlag als Hinweis mit Herkunft, grau unter dem Feld; „Übernehmen“, solange das Feld etwas anderes sagt.
      const source = (chunks: ReactNode) => <Link href={statuteSuggestion.source.href} className="text-link underline-offset-2 hover:underline">{chunks}</Link>;
      const differs = a.statuteDate !== statuteSuggestion.date;
      const hintValues = { date: fmt.date(statuteSuggestion.date), label: statuteSuggestion.source.label, link: source };
      const docId = statuteSuggestion.documentId;
      return (
        <FormCell key={field} size="m" className="flex flex-col gap-1.5">
          <FormField id={id} label={label(line)} required={line.required} size="m">
            {input}
          </FormField>
          <span className="text-hint text-muted-ink" data-testid="answer-statuteDate-source">
            {!differs ? t.rich('statuteFrom', hintValues) : a.statuteDate ? t.rich('statuteDiffers', hintValues) : t.rich('statuteOffer', hintValues)}
            {differs ? (
              <>
                {' '}
                <Button type="button" variant="link" className="h-auto p-0 text-hint font-normal" data-testid="answer-statuteDate-take" onClick={() => set({ statuteDate: statuteSuggestion.date })}>
                  {t('statuteTake')}
                </Button>
              </>
            ) : null}
          </span>
          {docId && !statuteLinked ? (
            <Button
              type="button"
              variant="link"
              className="h-auto w-fit p-0 text-hint font-normal"
              data-testid="answer-statuteDate-link"
              onClick={async () => {
                const result = await statuteLink.run(() => linkTaxPeriodDocumentAction({ id: period.id, slot: 'statute', documentId: docId }));
                if (result.status === 'success') router.refresh();
              }}
            >
              {t('statuteLink')}
            </Button>
          ) : null}
          <RefusalNotice state={statuteLink.state} />
        </FormCell>
      );
    }
    if (field === 'feeResolution') {
      const none = a.feeResolution === 'none';
      return (
        <Fragment key={field}>
          <FormField id={id} label={label(line)} required={line.required} size="m">
            <Input id={id} type="date" disabled={none} value={typeof a.feeResolution === 'object' ? a.feeResolution.date : ''} onChange={(e) => set({ feeResolution: e.target.value ? { date: e.target.value } : undefined })} />
          </FormField>
          <FormField id={`${id}-none`} label={t('noFeeResolution')} toggle size="m">
            <Checkbox id={`${id}-none`} checked={none} onCheckedChange={(on) => set({ feeResolution: on === true ? 'none' : undefined, ...(on === true ? { feeResolutionSubmission: undefined } : {}) })} />
          </FormField>
        </Fragment>
      );
    }
    // Zeile 6 und 8: liegt vor / wird gesondert übermittelt.
    const value = a[field as 'statuteSubmission' | 'feeResolutionSubmission'];
    return (
      <FormField key={field} id={id} label={label(line)} required={line.required || field === 'feeResolutionSubmission'} size="m">
        <Select id={id} value={value ?? ''} onChange={(e) => set({ [field]: (e.target.value || undefined) as Submission | undefined } as Partial<GemAnswers>)}>
          <option value="">{t('choose')}</option>
          <option value="onFile">{t('submission.onFile')}</option>
          <option value="willSubmit">{t('submission.willSubmit')}</option>
        </Select>
      </FormField>
    );
  };

  const giftLine = lines.find((l) => answerField(l) === 'gratuitousBenefitList');
  const gifts =
    giftLine && a.gratuitousBenefits === true ? (
      <div className="flex flex-col gap-2" id="answer-gratuitousBenefitList" data-testid="answer-gifts">
        <Overline>{label(giftLine)}</Overline>
        {editable ? (
          <>
            {d.gifts.map((g, i) => (
              <FormGrid key={g.key}>
                <FormField id={`answer-gift-${g.key}-reason`} label={t('giftReason')} required size="l">
                  <Input id={`answer-gift-${g.key}-reason`} value={g.reason} onChange={(e) => setD((s) => ({ ...s, gifts: s.gifts.map((x) => (x.key === g.key ? { ...x, reason: e.target.value } : x)) }))} />
                </FormField>
                <FormField id={`answer-gift-${g.key}-amount`} label={t('giftAmount')} required size="s">
                  <span className="flex items-center gap-2">
                    <AmountField id={`answer-gift-${g.key}-amount`} name={`gift-${i}`} value={g.amount} onChange={(v) => { setD((s) => ({ ...s, gifts: s.gifts.map((x) => (x.key === g.key ? { ...x, amount: v } : x)) })); clearAmountError(`answer-gift-${g.key}-amount`); }} required invalid={`answer-gift-${g.key}-amount` in amountErrors} errorText={amountError(`answer-gift-${g.key}-amount`)} />
                    <RowMenu name={g.reason || t('giftEntry', { n: i + 1 })} items={[{ key: 'remove', label: t('giftRemove'), onSelect: () => setD((s) => ({ ...s, gifts: s.gifts.filter((x) => x.key !== g.key) })) }]} />
                  </span>
                </FormField>
              </FormGrid>
            ))}
            <div>
              <Button type="button" variant="outline" size="sm" onClick={() => setD((s) => ({ ...s, gifts: [...s.gifts, { key: `n${Date.now()}-${s.gifts.length}`, reason: '', amount: '' }] }))} data-testid="answer-gift-add">
                {t('giftAdd')}
              </Button>
            </div>
          </>
        ) : (
          <ul className="flex flex-col gap-1 text-body">
            {(a.gratuitousBenefitList ?? []).map((g, i) => (
              <li key={i} className="flex justify-between gap-4">
                <span>{g.reason}</span>
                <span className="tabular-nums">{formatEuro(g.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    ) : null;

  const reserveGroups = (
    <>
      {replacementReserves.map((r) => {
        const v = d.replacement[r.id] ?? { asset: '', expectedCost: '', regularDepreciation: '' };
        const put = (patch: Partial<typeof v>) => setD((s) => ({ ...s, replacement: { ...s.replacement, [r.id]: { ...v, ...patch } } }));
        return (
          <div key={r.id} className="flex flex-col gap-2" id={`answer-reserve-${r.id}`}>
            <Overline>{t('replacementGroup', { name: r.name })}</Overline>
            <FormGrid>
              {editable ? (
                <>
                  <FormField id={`answer-asset-${r.id}`} label={t('asset')} required size="l">
                    <Input id={`answer-asset-${r.id}`} value={v.asset} onChange={(e) => put({ asset: e.target.value })} />
                  </FormField>
                  <FormRowBreak />
                  <FormField id={`answer-cost-${r.id}`} label={t('expectedCost')} size="s">
                    <AmountField id={`answer-cost-${r.id}`} name={`cost-${r.id}`} value={v.expectedCost} onChange={(x) => { put({ expectedCost: x }); clearAmountError(`answer-cost-${r.id}`); }} invalid={`answer-cost-${r.id}` in amountErrors} />
                  </FormField>
                  <FormField id={`answer-afa-${r.id}`} label={t('regularDepreciation')} size="s">
                    <AmountField id={`answer-afa-${r.id}`} name={`afa-${r.id}`} value={v.regularDepreciation} onChange={(x) => { put({ regularDepreciation: x }); clearAmountError(`answer-afa-${r.id}`); }} invalid={`answer-afa-${r.id}` in amountErrors} />
                  </FormField>
                </>
              ) : (
                <FixedValue id={`answer-asset-${r.id}`} label={t('asset')} value={v.asset || null} {...fixedProps} size="l" />
              )}
            </FormGrid>
          </div>
        );
      })}
      {participationReserves.map((r) => {
        const v = d.participations[r.id] ?? { company: '', taxOffice: '', taxNumber: '' };
        const put = (patch: Partial<typeof v>) => setD((s) => ({ ...s, participations: { ...s.participations, [r.id]: { ...v, ...patch } } }));
        return (
          <div key={r.id} className="flex flex-col gap-2" id={`answer-reserve-${r.id}`}>
            <Overline>{t('participationGroup', { name: r.name })}</Overline>
            <FormGrid>
              {editable ? (
                <>
                  <FormField id={`answer-company-${r.id}`} label={t('company')} required size="l">
                    <Input id={`answer-company-${r.id}`} value={v.company} onChange={(e) => put({ company: e.target.value })} />
                  </FormField>
                  <FormRowBreak />
                  <FormField id={`answer-office-${r.id}`} label={t('taxOffice')} required size="m">
                    <Input id={`answer-office-${r.id}`} value={v.taxOffice} onChange={(e) => put({ taxOffice: e.target.value })} />
                  </FormField>
                  <FormField id={`answer-number-${r.id}`} label={t('taxNumber')} required size="s">
                    <Input id={`answer-number-${r.id}`} value={v.taxNumber} onChange={(e) => put({ taxNumber: e.target.value })} />
                  </FormField>
                </>
              ) : (
                <FixedValue id={`answer-company-${r.id}`} label={t('company')} value={v.company || null} {...fixedProps} size="l" />
              )}
            </FormGrid>
          </div>
        );
      })}
    </>
  );

  const members = (
    <div className="flex flex-col gap-2" id="answer-memberCounts">
      <Overline>{t('membersGroup')}</Overline>
      <FormGrid>
        {years.map((y) => {
          const id = `answer-members-${y.id}`;
          const value = d.members[y.id] ?? '';
          const suggestion = memberSuggestions?.[y.id];
          const label = t('members', { date: fmt.date(y.endsOn) });
          if (!editable) return <FixedValue key={y.id} id={id} label={label} value={value || null} {...(filed ? fixedProps : { reason: t('membersReason') })} size="s" />;
          const differs = suggestion !== undefined && value !== String(suggestion);
          return (
            <FormCell key={y.id} size="s" className="flex flex-col gap-1.5">
              <FormField id={id} label={label} size="s">
                <CountField id={id} min={0} value={value} onChange={(e) => setD((s) => ({ ...s, members: { ...s.members, [y.id]: e.target.value } }))} />
              </FormField>
              {suggestion === undefined ? null : differs ? (
                <span className="text-hint text-muted-ink" data-testid={`answer-members-${y.id}-changed`}>
                  {t('membersChanged', { count: suggestion })}{' '}
                  <Button type="button" variant="link" className="h-auto p-0 text-hint font-normal" onClick={() => setD((s) => ({ ...s, members: { ...s.members, [y.id]: String(suggestion) } }))}>
                    {t('membersTake')}
                  </Button>
                </span>
              ) : (
                <span className="text-hint text-muted-ink">{today && today < y.endsOn ? t('membersFromToday') : t('membersFrom', { date: fmt.date(y.endsOn) })}</span>
              )}
            </FormCell>
          );
        })}
      </FormGrid>
    </div>
  );

  const body = (
    <FormCardBody>
      <Section title={t('title')} intro={t('intro')}>
        <div className="flex flex-col gap-5">
          <FormGrid>{lines.map(lineField)}</FormGrid>
          {gifts}
          {reserveGroups}
          {members}
        </div>
      </Section>
    </FormCardBody>
  );

  if (!editable) {
    const card = <FormCard as="section" data-testid="tax-answers">{body}</FormCard>;
    if (!filed) return card;
    return (
      <div className="flex flex-col gap-2">
        <Notice level="hint" testId="tax-answers-filed">
          <span id="tax-answers-filed-text">{readOnlyReason}</span>
        </Notice>
        {card}
      </div>
    );
  }
  return (
    <FormCard
      as="form"
      data-testid="tax-answers"
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        void save();
      }}
    >
      {body}
      <FormActionBar count={changed} onSave={() => void save()} onDiscard={() => setD(initialDraft)} pending={pending} state={withUnplacedFieldErrors(feedback.state, [])} saveTestId="tax-answers-save" />
    </FormCard>
  );
}
