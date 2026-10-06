'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { Disclosure } from '@/components/ui/disclosure';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSavedVersions } from '@/lib/saved-versions';
import { confirmSetupStepAction, saveCategoryAction, setCategoryActiveAction, type CategoryInput } from './actions';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';

export interface CategoryRow {
  id: string;
  expectedVersion: string;
  key: string;
  name: string;
  explanation: string;
  direction: 'income' | 'expense' | 'transit';
  sphere: 'ideal' | 'assetManagement' | 'purposeOperation' | 'business' | null;
  incomeKind: string | null;
  costFunction: string | null;
  allowanceKind: string;
  statementSuffices: boolean;
  defaultTaxCode: string;
  inputTaxDeductible: string;
  countsTowardTurnover: boolean;
  isAssetSale: boolean;
  externalAccountNumber: string | null;
  isActive: boolean;
}

const SPHERES = ['ideal', 'assetManagement', 'purposeOperation', 'business'] as const;
const INCOME_KINDS = ['donation', 'membershipFee', 'inKindDonation', 'expenseWaiver', 'bodyGrant', 'publicGrant', 'courtFine', 'sponsoring', 'sales', 'fees', 'interest', 'inheritance', 'other'] as const;
const COST_FUNCTIONS = ['program', 'administration', 'fundraising'] as const;
const ALLOWANCE_KINDS = ['none', 'volunteer', 'trainer'] as const;
const TAX_CODES = ['none', 'exemptCounted', 'exemptNotCounted', 'reduced', 'standard', 'rc13b', 'icAcquisition'] as const;
const INPUT_TAX = ['no', 'yes', 'partial'] as const;

/** H3 — gruppiert nach steuerlichem Bereich; Regelverstöße am Feld, „Erweitert“ als Disclosure. */
export function CategoriesPanel({ categories, confirmedAt }: { categories: CategoryRow[]; confirmedAt: string | null }) {
  const t = useTranslations('finance.admin.categories');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [editing, setEditing] = useState<CategoryRow | null | 'new'>(null);
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState(false);
  const reviewFb = useActionFeedback();
  // Befund 43: Die Version aus der Speicher-Antwort gilt sofort (`useSavedVersions`).
  const versions = useSavedVersions();
  const openRow = (row: CategoryRow) => setEditing(versions.latest(row));

  const grouped = useMemo(() => {
    const filtered = categories.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()) || c.key.toLowerCase().includes(search.toLowerCase()));
    const bySphere = new Map<string, CategoryRow[]>();
    for (const c of filtered) {
      const groupKey = c.direction === 'transit' ? 'transit' : (c.sphere ?? 'none');
      if (!bySphere.has(groupKey)) bySphere.set(groupKey, []);
      bySphere.get(groupKey)!.push(c);
    }
    return bySphere;
  }, [categories, search]);

  const confirmReviewed = async () => {
    setPending(true);
    const result = await reviewFb.run(() => confirmSetupStepAction('categories'), { retry: () => void confirmReviewed() });
    setPending(false);
    if (result.status !== 'success') return;
    router.refresh();
  };

  return (
    <section className="space-y-4" data-testid="categories-panel">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="flex items-center gap-2">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('search')} className="w-52" />
          <Button size="sm" onClick={() => setEditing('new')}>
            {t('create')}
          </Button>
        </div>
      </div>

      {[...grouped.entries()].map(([sphere, rows]) => (
        <div key={sphere} className="space-y-2">
          <h3 className="text-[12px] font-semibold uppercase tracking-[.04em] text-muted-ink">{t(`sphereGroup.${sphere}`)}</h3>
          <div className="overflow-hidden rounded-md border border-line">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('columns.name')}</TableHead>
                  <TableHead>{t('columns.direction')}</TableHead>
                  <TableHead>{t('columns.statementSuffices')}</TableHead>
                  <TableHead>{t('columns.active')}</TableHead>
                  <TableHead className="text-right">{tCommon('edit')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} data-testid={`category-row-${row.key}`}>
                    <TableCell className="font-medium text-ink">{row.name}</TableCell>
                    <TableCell className="text-ink-2">{t(`directions.${row.direction}`)}</TableCell>
                    <TableCell className="text-ink-2">{row.statementSuffices ? tCommon('yes') : tCommon('no')}</TableCell>
                    <TableCell>
                      <StatusBadge tone={row.isActive ? 'success' : 'neutral'}>{row.isActive ? t('columns.active') : t('inactiveState')}</StatusBadge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => openRow(row)}>
                        {tCommon('edit')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ))}

      <div className="space-y-2 pt-2">
        <RefusalNotice action state={reviewFb.state} />
        <p className="text-[13px] text-muted-ink">{confirmedAt ? t('reviewedAt', { date: confirmedAt.slice(0, 10) }) : t('notReviewed')}</p>
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => void confirmReviewed()} data-testid="review-categories">
          {t('review')}
        </Button>
      </div>

      {editing ? (
        <CategoryDialog
          category={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            versions.remember(saved);
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}

function CategoryDialog({ category, onClose, onSaved }: { category: CategoryRow | null; onClose: () => void; onSaved: (saved?: { id: string; updatedAt: string }) => void }) {
  const t = useTranslations('finance.admin.categories');
  const tCommon = useTranslations('common');
  const [key, setKey] = useState(category?.key ?? '');
  const [name, setName] = useState(category?.name ?? '');
  const [explanation, setExplanation] = useState(category?.explanation ?? '');
  const [direction, setDirection] = useState<CategoryRow['direction']>(category?.direction ?? 'income');
  const [sphere, setSphere] = useState<'ideal' | 'assetManagement' | 'purposeOperation' | 'business' | ''>(category?.sphere ?? '');
  const [statementSuffices, setStatementSuffices] = useState(category?.statementSuffices ?? false);
  const [defaultTaxCode, setDefaultTaxCode] = useState(category?.defaultTaxCode ?? 'none');
  const [isActive, setIsActive] = useState(category?.isActive ?? true);
  const [incomeKind, setIncomeKind] = useState(category?.incomeKind ?? '');
  const [costFunction, setCostFunction] = useState(category?.costFunction ?? '');
  const [allowanceKind, setAllowanceKind] = useState(category?.allowanceKind ?? 'none');
  const [inputTaxDeductible, setInputTaxDeductible] = useState(category?.inputTaxDeductible ?? 'no');
  const [countsTowardTurnover, setCountsTowardTurnover] = useState(category?.countsTowardTurnover ?? false);
  const [isAssetSale, setIsAssetSale] = useState(category?.isAssetSale ?? false);
  const [externalAccountNumber, setExternalAccountNumber] = useState(category?.externalAccountNumber ?? '');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();
  const fieldErrors = feedback.state.status === 'error' ? feedback.state.fieldErrors : {};

  const submit = async () => {
    setPending(true);
    const input: CategoryInput = {
      id: category?.id,
      expectedVersion: category?.expectedVersion,
      key: category ? undefined : key,
      name,
      explanation,
      direction,
      sphere: direction === 'transit' ? undefined : (sphere || undefined),
      incomeKind: direction === 'income' ? incomeKind || undefined : undefined,
      costFunction: direction === 'expense' ? costFunction || undefined : undefined,
      allowanceKind,
      statementSuffices,
      defaultTaxCode,
      inputTaxDeductible,
      countsTowardTurnover,
      isAssetSale,
      externalAccountNumber: externalAccountNumber || null,
      isActive,
    };
    const result = await feedback.run(() => saveCategoryAction(input), { retry: () => void submit() });
    setPending(false);
    if (result.status === 'success') {
      const saved = result.data as { id?: string; updatedAt?: string } | undefined;
      onSaved(saved?.id && saved.updatedAt ? { id: saved.id, updatedAt: saved.updatedAt } : undefined);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md" layout="fixed-footer" className="bg-surface shadow-md">
        <DialogHeader>
          <DialogTitle className="font-heading text-[19px]">{category ? t('edit') : t('create')}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <section>
            <h3 className="text-[15px] font-semibold">{t('sections.basics')}</h3>
            <div className="mt-3">
              <FormGrid>
                {!category ? (
                  <FormField id="cat-key" label={t('columns.key')} required size="s">
                    <Input id="cat-key" value={key} onChange={(e) => setKey(e.target.value)} required />
                  </FormField>
                ) : null}
                <FormField id="cat-name" label={t('columns.name')} required>
                  <Input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} required />
                </FormField>
                <FormField id="cat-explanation" label={t('explanation')} size="l">
                  <Textarea id="cat-explanation" rows={2} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
                </FormField>
              </FormGrid>
            </div>
          </section>
          <section className="mt-5 border-t border-line pt-5">
            <h3 className="text-[15px] font-semibold">{t('sections.tax')}</h3>
            <div className="mt-3">
              <FormGrid>
                <FormField id="cat-direction" label={t('columns.direction')} size="s">
                  <Select id="cat-direction" value={direction} onChange={(e) => setDirection(e.target.value as CategoryRow['direction'])}>
                    <option value="income">{t('directions.income')}</option>
                    <option value="expense">{t('directions.expense')}</option>
                    <option value="transit">{t('directions.transit')}</option>
                  </Select>
                </FormField>
                {direction !== 'transit' ? (
                  <FormField id="cat-sphere" label={t('sphere')} required>
                    <Select id="cat-sphere" value={sphere} onChange={(e) => setSphere(e.target.value as 'ideal' | 'assetManagement' | 'purposeOperation' | 'business' | '')} aria-invalid={!!fieldErrors.sphere}>
                      <option value="">{t('spherePlaceholder')}</option>
                      {SPHERES.map((s) => (
                        <option key={s} value={s}>
                          {t(`sphereGroup.${s}`)}
                        </option>
                      ))}
                    </Select>
                    {fieldErrors.sphere ? (
                      <p role="alert" className="text-[12px] text-error" data-testid="category-sphere-error">
                        {fieldErrors.sphere}
                      </p>
                    ) : null}
                  </FormField>
                ) : null}
                <FormField id="cat-tax-code" label={t('defaultTaxCode')}>
                  <Select id="cat-tax-code" value={defaultTaxCode} onChange={(e) => setDefaultTaxCode(e.target.value)}>
                    {TAX_CODES.map((code) => (
                      <option key={code} value={code}>
                        {t(`taxCodes.${code}`)}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField id="cat-statement-suffices" label={t('statementSuffices')} toggle>
                  <Checkbox id="cat-statement-suffices" checked={statementSuffices} onCheckedChange={(checked) => setStatementSuffices(checked)} />
                </FormField>
                <FormField id="cat-active" label={t('columns.active')} toggle>
                  <Checkbox id="cat-active" checked={isActive} onCheckedChange={(checked) => setIsActive(checked)} />
                </FormField>
              </FormGrid>
            </div>
          </section>
          <div className="mt-5">
            <Disclosure label={t('advanced')} defaultOpen={fieldErrors.incomeKind !== undefined || fieldErrors.costFunction !== undefined}>
              <div className="pt-1">
                <FormGrid>
                  {direction === 'income' ? (
                    <FormField id="cat-income-kind" label={t('incomeKind')}>
                      <Select id="cat-income-kind" value={incomeKind} onChange={(e) => setIncomeKind(e.target.value)} aria-invalid={!!fieldErrors.incomeKind}>
                        <option value="">{t('spherePlaceholder')}</option>
                        {INCOME_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {t(`incomeKinds.${k}`)}
                          </option>
                        ))}
                      </Select>
                      {fieldErrors.incomeKind ? (
                        <p role="alert" className="text-[12px] text-error" data-testid="category-income-kind-error">
                          {fieldErrors.incomeKind}
                        </p>
                      ) : null}
                    </FormField>
                  ) : null}
                  {direction === 'expense' ? (
                    <FormField id="cat-cost-function" label={t('costFunction')}>
                      <Select id="cat-cost-function" value={costFunction} onChange={(e) => setCostFunction(e.target.value)} aria-invalid={!!fieldErrors.costFunction}>
                        <option value="">{t('spherePlaceholder')}</option>
                        {COST_FUNCTIONS.map((c) => (
                          <option key={c} value={c}>
                            {t(`costFunctions.${c}`)}
                          </option>
                        ))}
                      </Select>
                      {fieldErrors.costFunction ? (
                        <p role="alert" className="text-[12px] text-error">
                          {fieldErrors.costFunction}
                        </p>
                      ) : null}
                    </FormField>
                  ) : null}
                  <FormField id="cat-allowance-kind" label={t('allowanceKind')}>
                    <Select id="cat-allowance-kind" value={allowanceKind} onChange={(e) => setAllowanceKind(e.target.value)}>
                      {ALLOWANCE_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {t(`allowanceKinds.${k}`)}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField id="cat-input-tax" label={t('inputTaxDeductible')} size="s">
                    <Select id="cat-input-tax" value={inputTaxDeductible} onChange={(e) => setInputTaxDeductible(e.target.value)}>
                      {INPUT_TAX.map((v) => (
                        <option key={v} value={v}>
                          {t(`inputTax.${v}`)}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField id="cat-external-account" label={t('externalAccountNumber')} size="s">
                    <Input id="cat-external-account" value={externalAccountNumber} onChange={(e) => setExternalAccountNumber(e.target.value)} />
                  </FormField>
                  <FormField id="cat-turnover" label={t('countsTowardTurnover')} toggle>
                    <Checkbox id="cat-turnover" checked={countsTowardTurnover} onCheckedChange={(checked) => setCountsTowardTurnover(checked)} />
                  </FormField>
                  <FormField id="cat-asset-sale" label={t('isAssetSale')} toggle>
                    <Checkbox id="cat-asset-sale" checked={isAssetSale} onCheckedChange={(checked) => setIsAssetSale(checked)} />
                  </FormField>
                </FormGrid>
              </div>
            </Disclosure>
          </div>
        </DialogBody>
        <FormActionBar placement="dialog" cancel={onClose} pending={pending} saveDisabled={!name || (!category && !key)} saveLabel={tCommon('save')} onSave={() => void submit()} state={withUnplacedFieldErrors(feedback.state, ['sphere', 'incomeKind', 'costFunction'])} />
      </DialogContent>
    </Dialog>
  );
}
