'use client';

import type { AgendaItemView, MeetingContext } from '@kompass/module-governance';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DocumentPicker } from '@/app/(shell)/dms/document-picker';
import { FixedValue } from '@/components/fixed-value';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { Overline } from '@/components/overline';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { majorityText, ruleSource } from '@/lib/governance/majority-text';
import { saveAgendaItemAction } from './actions';

/** Arten, die man anlegt — `agenda` entsteht nur aus der Aufnahme eines Antrags. */
export const ITEM_KINDS = ['simple', 'statute', 'purpose', 'dissolution', 'election', 'dismissal', 'discharge', 'accounts', 'feeSchedule', 'exclusion', 'honoraryMember', 'mandate', 'reserve', 'remuneration', 'expenseRule', 'minutesApproval', 'report', 'discussion', 'other'] as const;

export interface AgendaItemDraft {
  item: AgendaItemView | null;
  /** „Aufnehmen …“ aus einem Antrag: Titel und Antrag vorbelegt. */
  motion?: { id: string; text: string };
}

/**
 * Punkt anlegen oder bearbeiten (Board 2b A, `md`): Titel, Art, Antrag, je nach Art Amt, Geschäftsjahr oder
 * Satzungsstand, die Mehrheit aus dem Regelwerk als Lesezeile, Anlagen aus der Akte. Ablehnung bleibt im Dialog.
 */
export function AgendaItemDialog({
  meetingId,
  draft,
  context,
  statutes,
  documentLabels,
  canPickDocuments,
  onClose,
}: {
  meetingId: string;
  draft: AgendaItemDraft;
  context: MeetingContext;
  statutes: { id: string; label: string }[];
  documentLabels: Record<string, string>;
  canPickDocuments: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('governance.agenda.dialog');
  const tk = useTranslations('governance.agendaKinds');
  const tm = useTranslations('governance.majority');
  const router = useRouter();
  const item = draft.item;
  const [title, setTitle] = useState(item?.title ?? draft.motion?.text.slice(0, 300) ?? '');
  const [kind, setKind] = useState<string>(item?.kind ?? 'simple');
  const [proposal, setProposal] = useState(item?.proposal ?? draft.motion?.text ?? '');
  const [officeId, setOfficeId] = useState(item?.officeIds[0] ?? '');
  const [fiscalYearId, setFiscalYearId] = useState(item?.fiscalYearId ?? '');
  const [statuteId, setStatuteId] = useState(item?.statuteId ?? '');
  const [attachments, setAttachments] = useState<{ id: string; label: string }[]>((item?.attachmentDocumentIds ?? []).map((id) => ({ id, label: documentLabels[id] ?? id })));
  const [wording, setWording] = useState<{ key: number; label: string; before: string; after: string }[]>((item?.wordingChanges ?? []).map((w, i) => ({ key: i, ...w })));
  const [pending, setPending] = useState(false);
  const withWording = kind === 'statute' || kind === 'purpose';
  const setRow = (key: number, patch: Partial<{ label: string; before: string; after: string }>) => setWording((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const feedback = useActionFeedback();

  const offices = context.offices;
  const majority = (context.rules.majorityByKind as Record<string, (typeof context.rules.majorityByKind)['simple'] | undefined>)[kind] ?? null;

  const save = async () => {
    setPending(true);
    const result = await feedback.run(
      () =>
        saveAgendaItemAction({
          ...(item ? { id: item.id } : {}),
          meetingId,
          kind,
          title,
          proposal: proposal.trim() || null,
          attachmentDocumentIds: attachments.map((a) => a.id),
          officeIds: kind === 'election' && officeId ? [officeId] : [],
          fiscalYearId: (kind === 'discharge' || kind === 'accounts') && fiscalYearId ? fiscalYearId : null,
          statuteId: (kind === 'statute' || kind === 'purpose') && statuteId ? statuteId : null,
          motionId: item?.motionId ?? draft.motion?.id ?? null,
          ...(withWording ? { wordingChanges: wording.map(({ label, before, after }) => ({ label, before, after })) } : {}),
        }),
      { retry: () => void save() },
    );
    setPending(false);
    if (result.status !== 'success') return;
    onClose();
    router.refresh();
  };

  const errors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      {/* Mit der Unterliste der Absätze mehr als sechs Felder: `lg` (MUSTER § I). */}
      <DialogContent size={withWording && wording.length > 0 ? 'lg' : 'md'}>
        <DialogHeader>
          <DialogTitle>{item ? t('editTitle') : t('createTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <DialogBody>
            <FormGrid>
              <FormField id="agenda-title" label={t('title')} required size="full" error={errors.title}>
                <Input id="agenda-title" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="agenda-item-title" />
              </FormField>
              <FormField id="agenda-kind" label={t('kind')} required error={errors.kind}>
                <Select id="agenda-kind" value={kind} onChange={(e) => setKind(e.target.value)} data-testid="agenda-item-kind">
                  {ITEM_KINDS.map((k) => (
                    <option key={k} value={k}>{tk(k)}</option>
                  ))}
                </Select>
              </FormField>
              {kind === 'election' ? (
                <FormField id="agenda-office" label={t('office')} error={errors.officeIds}>
                  <Select id="agenda-office" value={officeId} onChange={(e) => setOfficeId(e.target.value)}>
                    <option value="">{t('choose')}</option>
                    {offices.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </Select>
                </FormField>
              ) : null}
              {kind === 'discharge' || kind === 'accounts' ? (
                <FormField id="agenda-year" label={t('fiscalYear')} size="s" error={errors.fiscalYearId}>
                  <Select id="agenda-year" value={fiscalYearId} onChange={(e) => setFiscalYearId(e.target.value)}>
                    <option value="">{t('choose')}</option>
                    {context.fiscalYears.map((y) => (
                      <option key={y.id} value={y.id}>{y.designation}</option>
                    ))}
                  </Select>
                </FormField>
              ) : null}
              {kind === 'statute' || kind === 'purpose' ? (
                <FormField id="agenda-statute" label={t('statute')} error={errors.statuteId}>
                  <Select id="agenda-statute" value={statuteId} onChange={(e) => setStatuteId(e.target.value)}>
                    <option value="">{t('choose')}</option>
                    {statutes.map((s) => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </Select>
                </FormField>
              ) : null}
              {withWording ? (
                <FormCell size="full" as="fieldset">
                  <Overline field as="div">{t('wording')}</Overline>
                  <p className="text-hint text-muted-ink">{t('wordingHint')}</p>
                  {wording.map((row, index) => (
                    <div key={row.key} className="mt-3 flex items-start gap-2 border-b border-line-2 pb-3">
                      <FormGrid>
                        <FormField id={`wording-label-${row.key}`} label={t('wordingLabel')} size="s" error={errors[`wordingChanges.${index}.label`]}>
                          <Input id={`wording-label-${row.key}`} value={row.label} placeholder={t('wordingLabelPlaceholder')} onChange={(e) => setRow(row.key, { label: e.target.value })} />
                        </FormField>
                        <FormField id={`wording-before-${row.key}`} label={t('wordingBefore')} size="full">
                          <Textarea id={`wording-before-${row.key}`} rows={3} value={row.before} onChange={(e) => setRow(row.key, { before: e.target.value })} />
                        </FormField>
                        <FormField id={`wording-after-${row.key}`} label={t('wordingAfter')} size="full">
                          <Textarea id={`wording-after-${row.key}`} rows={3} value={row.after} onChange={(e) => setRow(row.key, { after: e.target.value })} />
                        </FormField>
                      </FormGrid>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={t('wordingRemove', { label: row.label || String(index + 1) })} onClick={() => setWording((rows) => rows.filter((r) => r.key !== row.key))}>
                        <X className="size-4" aria-hidden />
                      </Button>
                    </div>
                  ))}
                  <div className="mt-3">
                    <Button type="button" variant="outline" size="sm" onClick={() => setWording((rows) => [...rows, { key: Math.max(0, ...rows.map((r) => r.key + 1)), label: '', before: '', after: '' }])}>
                      {t('wordingAdd')}
                    </Button>
                  </div>
                </FormCell>
              ) : null}
              {majority ? <FixedValue id="agenda-majority" label={t('majority')} value={majorityText(tm, majority.value)} reason={ruleSource(tm, majority)} size="full" /> : null}
              <FormField id="agenda-proposal" label={t('proposal')} hint={t('proposalHint')} size="full" error={errors.proposal}>
                <Textarea id="agenda-proposal" rows={4} value={proposal} onChange={(e) => setProposal(e.target.value)} />
              </FormField>
              {canPickDocuments ? (
                <FormCell size="full">
                  <div className="flex flex-col gap-2">
                    {attachments.length > 0 ? (
                      <ul className="flex flex-col gap-1 text-meta" aria-label={t('attachments')}>
                        {attachments.map((a) => (
                          <li key={a.id} className="flex items-center justify-between gap-2 border-b border-line-2 py-1">
                            <span className="min-w-0 truncate">{a.label}</span>
                            <Button type="button" variant="ghost" size="icon-sm" aria-label={t('removeAttachment', { label: a.label })} onClick={() => setAttachments((list) => list.filter((x) => x.id !== a.id))}>
                              <X className="size-4" aria-hidden />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <DocumentPicker
                      id="agenda-attachment"
                      name="attachment"
                      label={t('attachment')}
                      value={null}
                      onChange={(doc) => {
                        if (doc && !attachments.some((a) => a.id === doc.id)) setAttachments((list) => [...list, { id: doc.id, label: doc.number ? `${doc.number} · ${doc.subject}` : doc.subject }]);
                      }}
                    />
                  </div>
                </FormCell>
              ) : null}
            </FormGrid>
          </DialogBody>
        </form>
        <FormActionBar placement="dialog" cancel={onClose} pending={pending} onSave={() => void save()} state={feedback.state} testId="agenda-item-footer" saveTestId="agenda-item-save" />
      </DialogContent>
    </Dialog>
  );
}
