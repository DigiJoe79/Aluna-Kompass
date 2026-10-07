'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { ContactPicker, type PickedContact } from '@/components/contact-picker';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { rulePreviewInput, ruleFormToInput, type RuleFormState } from '@/lib/finance/work-dialogs';
import { previewImportRuleAction, saveImportRuleAction } from './actions';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid } from '@/components/forms/form-grid';

export interface RuleDialogOptions {
  accounts: { id: string; name: string }[];
  /** Nur aktive Kategorien — eine stillgelegte lässt sich nicht als Ergebnis wählen. */
  categories: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  purposes: { id: string; name: string }[];
  taxCodeOptions: string[];
  showTax: boolean;
}

type Preview = { hitCount: number; differentlyBookedCount: number; differentlyBookedEntryIds: string[] } | null;

/**
 * „Künftig immer so?“ (F5 Task 8, HANDOFF § 12.8): Bedingung → Ergebnis, live
 * darunter, was die Regel unter den früheren Umsätzen träfe — mit dem Weg zu
 * den anders gebuchten — und der Satz, dass sie nur nach vorn wirkt. Derselbe
 * Dialog bearbeitet eine Regel auf der Regeln-Seite (`mode="edit"`).
 */
export function RuleDialog({
  open,
  onOpenChange,
  initial,
  mode,
  options,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: RuleFormState;
  mode: 'create' | 'edit';
  options: RuleDialogOptions;
  onSaved: () => void;
}) {
  const t = useTranslations('finance.work.rule');
  const tTax = useTranslations('finance.splitRow');
  const [form, setForm] = useState<RuleFormState>(initial);
  const [preview, setPreview] = useState<Preview>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const feedback = useActionFeedback();
  const [pending, startTransition] = useTransition();

  // Beim Öffnen gilt, was der Aufrufer gerade vorbelegt — nicht bei jedem Neuzeichnen, sonst wären Eingaben weg.
  useEffect(() => {
    if (open) {
      setForm(initial);
      setFieldErrors({});
      feedback.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const previewKey = JSON.stringify(rulePreviewInput(form));
  useEffect(() => {
    if (!open) return;
    const input = JSON.parse(previewKey) as ReturnType<typeof rulePreviewInput>;
    if (!input) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void previewImportRuleAction(input).then((result) => {
        if (!cancelled) setPreview(result);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, previewKey]);

  const set = (patch: Partial<RuleFormState>) => setForm((f) => ({ ...f, ...patch }));

  const save = () => {
    const built = ruleFormToInput(form);
    if (!built.ok) {
      setFieldErrors(built.fieldErrors);
      return;
    }
    setFieldErrors({});
    startTransition(async () => {
      const result = await feedback.run(() => saveImportRuleAction(built.input), { retry: save });
      if (result.status === 'error') {
        setFieldErrors(result.fieldErrors);
        return;
      }
      onOpenChange(false);
      onSaved();
    });
  };

  const errorText = (key: string): string | undefined =>
    fieldErrors[key] ? (fieldErrors[key] === 'format' ? t('fieldFormat') : fieldErrors[key] === 'required' ? t('fieldRequired') : fieldErrors[key]) : undefined;

  const title = mode === 'edit' ? t('editTitle') : t('title');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* fixed-footer: elf Felder in zwei Abschnitten und die Vorschau — die Mitte scrollt, Kopf und Leiste stehen. */}
      <DialogContent size="lg" layout="fixed-footer" className="bg-surface shadow-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogBody className="text-[13px]">
          <section>
            <p className="text-ink-2">{t('intro')}</p>
            <div className="mt-3">
              <FormGrid>
                <FormField id="rule-name" label={t('name')} required error={errorText('name')}>
                  <Input id="rule-name" value={form.name} onChange={(e) => set({ name: e.target.value })} aria-invalid={!!fieldErrors.name} />
                </FormField>
              </FormGrid>
            </div>
          </section>

          <section className="mt-5 border-t border-line pt-5">
            <h3 className="text-[15px] font-semibold">{t('condition')}</h3>
            <div className="mt-3">
              <FormGrid>
                <FormField id="rule-account" label={t('account')}>
                  <Select id="rule-account" value={form.accountId} onChange={(e) => set({ accountId: e.target.value })}>
                    <option value="">{t('anyAccount')}</option>
                    {options.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField id="rule-direction" label={t('direction')} size="s">
                  <Select id="rule-direction" value={form.direction} onChange={(e) => set({ direction: e.target.value as RuleFormState['direction'] })}>
                    <option value="">{t('anyDirection')}</option>
                    <option value="in">{t('in')}</option>
                    <option value="out">{t('out')}</option>
                  </Select>
                </FormField>
                <FormField id="rule-text" label={t('textContains')} hint={t('textHint')}>
                  <Input id="rule-text" value={form.textContains} onChange={(e) => set({ textContains: e.target.value })} />
                </FormField>
                <FormField id="rule-amount-min" label={t('amountMin')} size="s" error={errorText('amountMinCents')}>
                  <Input id="rule-amount-min" inputMode="decimal" value={form.amountMinText} onChange={(e) => set({ amountMinText: e.target.value })} aria-invalid={!!fieldErrors.amountMinCents} />
                </FormField>
                <FormField id="rule-amount-max" label={t('amountMax')} size="s" error={errorText('amountMaxCents')}>
                  <Input id="rule-amount-max" inputMode="decimal" value={form.amountMaxText} onChange={(e) => set({ amountMaxText: e.target.value })} aria-invalid={!!fieldErrors.amountMaxCents} />
                </FormField>
                {form.iban ? (
                  <FormField id="rule-iban" label={t('iban', { iban: form.iban })} toggle size="full">
                    <Checkbox id="rule-iban" checked={form.ibanOn} onCheckedChange={(checked) => set({ ibanOn: checked === true })} />
                  </FormField>
                ) : null}
              </FormGrid>
            </div>
          </section>

          <section className="mt-5 border-t border-line pt-5">
            <h3 className="text-[15px] font-semibold">{t('result')}</h3>
            <div className="mt-3">
              <FormGrid>
                <FormField id="rule-category" label={t('category')} required error={errorText('categoryId')}>
                  <Select id="rule-category" value={form.categoryId} onChange={(e) => set({ categoryId: e.target.value })} aria-invalid={!!fieldErrors.categoryId}>
                    <option value="">{t('chooseCategory')}</option>
                    {options.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormCell size="m">
                  <ContactPicker
                    id="rule-contact"
                    name="rule-contact"
                    label={t('contact')}
                    value={form.contactId ? { id: form.contactId, name: form.contactName ?? '' } : null}
                    onChange={(contact: PickedContact | null) => set({ contactId: contact?.id ?? null, contactName: contact?.name ?? null })}
                  />
                </FormCell>
                <FormField id="rule-project" label={t('project')}>
                  <Select id="rule-project" value={form.projectId ?? ''} onChange={(e) => set({ projectId: e.target.value || null })}>
                    <option value="">{t('none')}</option>
                    {options.projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField id="rule-purpose" label={t('purpose')}>
                  <Select id="rule-purpose" value={form.purposeId ?? ''} onChange={(e) => set({ purposeId: e.target.value || null })}>
                    <option value="">{t('none')}</option>
                    {options.purposes.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField id="rule-entry-text" label={t('entryText')}>
                  <Input id="rule-entry-text" value={form.entryText} onChange={(e) => set({ entryText: e.target.value })} />
                </FormField>
                {options.showTax ? (
                  <FormField id="rule-tax" label={t('taxCode')}>
                    <Select id="rule-tax" value={form.taxCode} onChange={(e) => set({ taxCode: e.target.value })}>
                      <option value="">{t('taxFromCategory')}</option>
                      {options.taxCodeOptions.map((code) => (
                        <option key={code} value={code}>
                          {tTax(`taxCode.${code}`)}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                ) : null}
                {mode === 'edit' ? (
                  <FormField id="rule-active" label={t('active')} toggle>
                    <Checkbox id="rule-active" checked={form.isActive} onCheckedChange={(checked) => set({ isActive: checked === true })} />
                  </FormField>
                ) : null}
              </FormGrid>
            </div>
          </section>

          <div className="mt-5 space-y-1 rounded-md bg-surface-2 px-3 py-2">
            <p data-testid="rule-preview" aria-live="polite" className="text-ink">
              {preview ? t('preview', { hits: preview.hitCount, different: preview.differentlyBookedCount }) : t('previewEmpty')}
            </p>
            {preview && preview.differentlyBookedEntryIds.length > 0 ? (
              <Link href={`/finance/entries?ids=${preview.differentlyBookedEntryIds.join(',')}`} className="font-semibold underline underline-offset-2">
                {t('previewLink')}
              </Link>
            ) : null}
            <p className="text-ink-2">{t('forwardOnly')}</p>
          </div>
        </DialogBody>
        <FormActionBar placement="dialog" cancel={() => onOpenChange(false)} pending={pending} saveLabel={t('save')} onSave={save} state={withUnplacedFieldErrors(feedback.state, ['name', 'categoryId', 'amountMinCents', 'amountMaxCents'])} />
      </DialogContent>
    </Dialog>
  );
}
