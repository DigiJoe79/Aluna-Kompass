'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type RefObject } from 'react';
import { toast } from 'sonner';
import { FixedValue } from '@/components/fixed-value';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { createRemarkAction } from './actions';

export interface RemarkTarget {
  type: 'entry' | 'document' | 'report' | 'year';
  id: string;
  /** „2025-0141 · Barausgabe Sommerfest“, „Kassenbericht“, „Jahr 2025“. */
  label: string;
}

/**
 * „Vermerk schreiben“ (Board 4d, Dialog `md`): Bezug als `FixedValue`, Art als `Segmented` mit einem Satz zur Folge,
 * Text, und „Von“ nur, wenn eine Prüferin auf Papier eingetragen ist — so überträgt ein Prüfer in Kompass ihre
 * Anmerkungen; der Vermerk nennt dann beide.
 */
export function RemarkDialog({
  open,
  onOpenChange,
  fiscalYearId,
  target,
  me,
  paperAuditors,
  treasurerName = null,
  finalFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fiscalYearId: string;
  target: RemarkTarget;
  /** Der eigene Name, für „Von“. */
  me: string;
  paperAuditors: { id: string; name: string }[];
  /** Wer Fragen beantwortet: der Name aus der Kontaktrolle Schatzmeister (Designer Runde 7, 281). */
  treasurerName?: string | null;
  finalFocus?: RefObject<HTMLElement | null>;
}) {
  const t = useTranslations('finance.audit');
  const router = useRouter();
  const [kind, setKind] = useState<'question' | 'finding'>('question');
  const [text, setText] = useState('');
  const [from, setFrom] = useState('');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  useEffect(() => {
    if (!open) return;
    setKind('question');
    setText('');
    setFrom('');
    feedback.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const fieldErrors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};
  const paper = paperAuditors.find((a) => a.id === from) ?? null;

  const save = async () => {
    setPending(true);
    const result = await feedback.run(() => createRemarkAction({ fiscalYearId, kind, targetType: target.type, targetId: target.id, text, ...(paper ? { onBehalfOfAuditorId: paper.id } : {}) }), { retry: () => void save() });
    setPending(false);
    if (result.status !== 'success') return;
    toast.success(t('remarks.done'));
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" finalFocus={finalFocus} data-testid="remark-dialog">
        <DialogHeader>
          <DialogTitle>{t('remarkDialog.title')}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <FormGrid>
              <FixedValue id="remark-target" label={t('remarkDialog.target')} value={target.label} reason={t('remarkDialog.targetReason')} size="full" />
            </FormGrid>
            <div className="flex flex-col gap-1.5">
              <Label id="remark-kind-label">{t('remarkDialog.kind')}</Label>
              {/* `self-start`: Der Rahmen umschließt nur die Segmente, wie in 13d (268/269). */}
              <Segmented
                className="self-start"
                aria-labelledby="remark-kind-label"
                aria-describedby="remark-kind-hint"
                value={kind}
                onValueChange={setKind}
                options={[
                  { value: 'question', label: t('remarks.kind.question') },
                  { value: 'finding', label: t('remarks.kind.finding') },
                ]}
              />
              <p id="remark-kind-hint" className="text-hint text-muted-ink">
                {kind === 'question' && treasurerName ? t('remarkDialog.kindHint.questionTo', { name: treasurerName }) : t(`remarkDialog.kindHint.${kind}`)}
              </p>
            </div>
            <FormGrid>
              <FormField id="remark-text" label={t('remarkDialog.text')} required size="full" error={fieldErrors.text}>
                <Textarea id="remark-text" value={text} onChange={(e) => setText(e.target.value)} rows={4} />
              </FormField>
              {paperAuditors.length > 0 ? (
                <FormField id="remark-from" label={t('remarkDialog.from')} size="full" hint={paper ? t('remarkDialog.fromHint', { name: paper.name, me }) : undefined} error={fieldErrors.onBehalfOfAuditorId}>
                  <Select id="remark-from" value={from} onChange={(e) => setFrom(e.target.value)}>
                    <option value="">{t('remarkDialog.fromSelf', { name: me })}</option>
                    {paperAuditors.map((a) => (
                      <option key={a.id} value={a.id}>
                        {t('remarkDialog.fromPaper', { name: a.name })}
                      </option>
                    ))}
                  </Select>
                </FormField>
              ) : null}
            </FormGrid>
          </div>
        </DialogBody>
        <FormActionBar
          placement="dialog"
          mode="create"
          cancel={() => onOpenChange(false)}
          pending={pending}
          saveLabel={t('remarkDialog.save')}
          onSave={() => void save()}
          state={withUnplacedFieldErrors(feedback.state, ['text', 'onBehalfOfAuditorId'])}
          testId="remark-footer"
        />
      </DialogContent>
    </Dialog>
  );
}
