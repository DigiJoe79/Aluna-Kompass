'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { ContactPicker, type PickedContact } from '@/components/contact-picker';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import type { ActionState } from '@/lib/actions';
import { rulePreviewInput, ruleFormToInput, type RuleFormState } from '@/lib/finance/work-dialogs';
import { previewImportRuleAction, saveImportRuleAction } from './actions';

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
  const tCommon = useTranslations('common');
  const tTax = useTranslations('finance.splitRow');
  const [form, setForm] = useState<RuleFormState>(initial);
  const [preview, setPreview] = useState<Preview>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [refusal, setRefusal] = useState<Extract<ActionState, { status: 'error' }> | null>(null);
  const [pending, startTransition] = useTransition();

  // Beim Öffnen gilt, was der Aufrufer gerade vorbelegt — nicht bei jedem Neuzeichnen, sonst wären Eingaben weg.
  useEffect(() => {
    if (open) {
      setForm(initial);
      setFieldErrors({});
      setRefusal(null);
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
      const result = await saveImportRuleAction(built.input);
      if (result.status === 'error') {
        setRefusal(result);
        setFieldErrors(result.fieldErrors);
        return;
      }
      if (result.status === 'success' && result.message) toast.success(result.message);
      onOpenChange(false);
      onSaved();
    });
  };

  const fieldError = (key: string) =>
    fieldErrors[key] ? (
      <p role="alert" className="text-[12px] text-error">
        {fieldErrors[key] === 'format' ? t('fieldFormat') : fieldErrors[key] === 'required' ? t('fieldRequired') : fieldErrors[key]}
      </p>
    ) : null;

  const title = mode === 'edit' ? t('editTitle') : t('title');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface shadow-md sm:max-w-[560px]">
        <DialogTitle className="font-heading text-[19px]">{title}</DialogTitle>
        <div className="max-h-[70vh] space-y-4 overflow-auto pr-1 text-[13px]">
          <p className="text-ink-2">{t('intro')}</p>
          <div className="space-y-1">
            <Label htmlFor="rule-name" required>
              {t('name')}
            </Label>
            <Input id="rule-name" value={form.name} onChange={(e) => set({ name: e.target.value })} aria-invalid={!!fieldErrors.name} />
            {fieldError('name')}
          </div>

          <fieldset className="space-y-3 rounded-md border border-line p-3">
            <legend className="px-1 text-[12px] font-semibold uppercase tracking-wide text-muted-ink">{t('condition')}</legend>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="rule-account">{t('account')}</Label>
                <Select id="rule-account" value={form.accountId} onChange={(e) => set({ accountId: e.target.value })}>
                  <option value="">{t('anyAccount')}</option>
                  {options.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="rule-direction">{t('direction')}</Label>
                <Select id="rule-direction" value={form.direction} onChange={(e) => set({ direction: e.target.value as RuleFormState['direction'] })}>
                  <option value="">{t('anyDirection')}</option>
                  <option value="in">{t('in')}</option>
                  <option value="out">{t('out')}</option>
                </Select>
              </div>
            </div>
            {form.iban ? (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.ibanOn} onChange={(e) => set({ ibanOn: e.target.checked })} className="size-4 rounded border-line" />
                <span>{t('iban', { iban: form.iban })}</span>
              </label>
            ) : null}
            <div className="space-y-1">
              <Label htmlFor="rule-text">{t('textContains')}</Label>
              <Input id="rule-text" value={form.textContains} onChange={(e) => set({ textContains: e.target.value })} />
              <p className="text-[12px] text-muted-ink">{t('textHint')}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="rule-amount-min">{t('amountMin')}</Label>
                <Input id="rule-amount-min" inputMode="decimal" value={form.amountMinText} onChange={(e) => set({ amountMinText: e.target.value })} aria-invalid={!!fieldErrors.amountMinCents} />
                {fieldError('amountMinCents')}
              </div>
              <div className="space-y-1">
                <Label htmlFor="rule-amount-max">{t('amountMax')}</Label>
                <Input id="rule-amount-max" inputMode="decimal" value={form.amountMaxText} onChange={(e) => set({ amountMaxText: e.target.value })} aria-invalid={!!fieldErrors.amountMaxCents} />
                {fieldError('amountMaxCents')}
              </div>
            </div>
          </fieldset>

          <fieldset className="space-y-3 rounded-md border border-line p-3">
            <legend className="px-1 text-[12px] font-semibold uppercase tracking-wide text-muted-ink">{t('result')}</legend>
            <div className="space-y-1">
              <Label htmlFor="rule-category" required>
                {t('category')}
              </Label>
              <Select id="rule-category" value={form.categoryId} onChange={(e) => set({ categoryId: e.target.value })} aria-invalid={!!fieldErrors.categoryId}>
                <option value="">{t('chooseCategory')}</option>
                {options.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              {fieldError('categoryId')}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="rule-project">{t('project')}</Label>
                <Select id="rule-project" value={form.projectId ?? ''} onChange={(e) => set({ projectId: e.target.value || null })}>
                  <option value="">{t('none')}</option>
                  {options.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="rule-purpose">{t('purpose')}</Label>
                <Select id="rule-purpose" value={form.purposeId ?? ''} onChange={(e) => set({ purposeId: e.target.value || null })}>
                  <option value="">{t('none')}</option>
                  {options.purposes.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <ContactPicker
              id="rule-contact"
              name="rule-contact"
              label={t('contact')}
              value={form.contactId ? { id: form.contactId, name: form.contactName ?? '' } : null}
              onChange={(contact: PickedContact | null) => set({ contactId: contact?.id ?? null, contactName: contact?.name ?? null })}
            />
            {options.showTax ? (
              <div className="space-y-1">
                <Label htmlFor="rule-tax">{t('taxCode')}</Label>
                <Select id="rule-tax" value={form.taxCode} onChange={(e) => set({ taxCode: e.target.value })}>
                  <option value="">{t('taxFromCategory')}</option>
                  {options.taxCodeOptions.map((code) => (
                    <option key={code} value={code}>
                      {tTax(`taxCode.${code}`)}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
            <div className="space-y-1">
              <Label htmlFor="rule-entry-text">{t('entryText')}</Label>
              <Input id="rule-entry-text" value={form.entryText} onChange={(e) => set({ entryText: e.target.value })} />
            </div>
            {mode === 'edit' ? (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.isActive} onChange={(e) => set({ isActive: e.target.checked })} className="size-4 rounded border-line" />
                <span>{t('active')}</span>
              </label>
            ) : null}
          </fieldset>

          <div className="space-y-1 rounded-md bg-surface-2 px-3 py-2">
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

          {refusal ? <Notice level="refuse">{refusal.detail ?? refusal.message}</Notice> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {tCommon('cancel')}
          </Button>
          <Button type="button" onClick={save} disabled={pending}>
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
