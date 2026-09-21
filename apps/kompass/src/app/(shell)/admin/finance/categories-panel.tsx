'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Disclosure } from '@/components/ui/disclosure';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { confirmSetupStepAction, saveCategoryAction, setCategoryActiveAction, type CategoryInput } from './actions';

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
    const result = await confirmSetupStepAction('categories');
    setPending(false);
    if (result.status === 'error') {
      toast.error(result.message);
      return;
    }
    if (result.status === 'success' && result.message) toast.success(result.message);
    router.refresh();
  };

  return (
    <section className="space-y-4" data-testid="categories-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-[18px] text-ink">{t('title')}</h2>
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
              <TableHeader className="bg-table-head text-left text-[12px] font-semibold uppercase tracking-[.04em] text-muted-ink">
                <TableRow className="h-9">
                  <TableHead className="px-4">{t('columns.name')}</TableHead>
                  <TableHead className="px-4">{t('columns.direction')}</TableHead>
                  <TableHead className="px-4">{t('columns.statementSuffices')}</TableHead>
                  <TableHead className="px-4">{t('columns.active')}</TableHead>
                  <TableHead className="px-4 text-right">{tCommon('edit')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} className="h-11 border-b border-line-2" data-testid={`category-row-${row.key}`}>
                    <TableCell className="px-4 font-medium text-ink">{row.name}</TableCell>
                    <TableCell className="px-4 text-ink-2">{t(`directions.${row.direction}`)}</TableCell>
                    <TableCell className="px-4 text-ink-2">{row.statementSuffices ? tCommon('yes') : tCommon('no')}</TableCell>
                    <TableCell className="px-4">
                      <StatusBadge tone={row.isActive ? 'success' : 'neutral'}>{row.isActive ? t('columns.active') : t('inactiveState')}</StatusBadge>
                    </TableCell>
                    <TableCell className="px-4 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(row)}>
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

      <div className="pt-2">
        <p className="text-[13px] text-muted-ink">{confirmedAt ? t('reviewedAt', { date: confirmedAt.slice(0, 10) }) : t('notReviewed')}</p>
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => void confirmReviewed()} data-testid="review-categories">
          {t('review')}
        </Button>
      </div>

      {editing ? (
        <CategoryDialog
          category={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}

function CategoryDialog({ category, onClose, onSaved }: { category: CategoryRow | null; onClose: () => void; onSaved: () => void }) {
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
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const submit = async () => {
    setPending(true);
    setError(null);
    setFieldErrors({});
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
    const result = await saveCategoryAction(input);
    setPending(false);
    if (result.status === 'error') {
      setError(result.message);
      setFieldErrors(result.fieldErrors ?? {});
      toast.error(result.message);
      return;
    }
    if (result.status === 'success') {
      if (result.status === 'success' && result.message) toast.success(result.message);
      onSaved();
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-surface shadow-md sm:max-w-[520px]">
        <DialogTitle className="font-heading text-[19px]">{category ? t('edit') : t('create')}</DialogTitle>
        <div className="max-h-[70vh] space-y-3.5 overflow-auto pr-1">
          {error ? <div className="rounded-md bg-error-bg p-2.5 text-[13px] text-error">{error}</div> : null}
          {!category ? (
            <div className="space-y-1.5">
              <Label htmlFor="cat-key" required>{t('columns.key')}</Label>
              <Input id="cat-key" value={key} onChange={(e) => setKey(e.target.value)} required />
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="cat-name" required>{t('columns.name')}</Label>
            <Input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-explanation">{t('explanation')}</Label>
            <Input id="cat-explanation" value={explanation} onChange={(e) => setExplanation(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-direction">{t('columns.direction')}</Label>
            <Select id="cat-direction" value={direction} onChange={(e) => setDirection(e.target.value as CategoryRow['direction'])}>
              <option value="income">{t('directions.income')}</option>
              <option value="expense">{t('directions.expense')}</option>
              <option value="transit">{t('directions.transit')}</option>
            </Select>
          </div>
          {direction !== 'transit' ? (
            <div className="space-y-1.5">
              <Label htmlFor="cat-sphere" required>{t('sphere')}</Label>
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
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <input type="checkbox" id="cat-statement-suffices" checked={statementSuffices} onChange={(e) => setStatementSuffices(e.target.checked)} className="size-4 rounded border-line" />
            <Label htmlFor="cat-statement-suffices" className="cursor-pointer text-[13px]">
              {t('statementSuffices')}
            </Label>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-tax-code">{t('defaultTaxCode')}</Label>
            <Select id="cat-tax-code" value={defaultTaxCode} onChange={(e) => setDefaultTaxCode(e.target.value)}>
              {TAX_CODES.map((code) => (
                <option key={code} value={code}>
                  {t(`taxCodes.${code}`)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="cat-active" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="size-4 rounded border-line" />
            <Label htmlFor="cat-active" className="cursor-pointer text-[13px]">
              {t('columns.active')}
            </Label>
          </div>

          <Disclosure label={t('advanced')} defaultOpen={fieldErrors.incomeKind !== undefined || fieldErrors.costFunction !== undefined}>
            <div className="space-y-3 pt-1">
              {direction === 'income' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="cat-income-kind">{t('incomeKind')}</Label>
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
                </div>
              ) : null}
              {direction === 'expense' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="cat-cost-function">{t('costFunction')}</Label>
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
                </div>
              ) : null}
              <div className="space-y-1.5">
                <Label htmlFor="cat-allowance-kind">{t('allowanceKind')}</Label>
                <Select id="cat-allowance-kind" value={allowanceKind} onChange={(e) => setAllowanceKind(e.target.value)}>
                  {ALLOWANCE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`allowanceKinds.${k}`)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cat-input-tax">{t('inputTaxDeductible')}</Label>
                <Select id="cat-input-tax" value={inputTaxDeductible} onChange={(e) => setInputTaxDeductible(e.target.value)}>
                  {INPUT_TAX.map((v) => (
                    <option key={v} value={v}>
                      {t(`inputTax.${v}`)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="cat-turnover" checked={countsTowardTurnover} onChange={(e) => setCountsTowardTurnover(e.target.checked)} className="size-4 rounded border-line" />
                <Label htmlFor="cat-turnover" className="cursor-pointer text-[13px]">
                  {t('countsTowardTurnover')}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="cat-asset-sale" checked={isAssetSale} onChange={(e) => setIsAssetSale(e.target.checked)} className="size-4 rounded border-line" />
                <Label htmlFor="cat-asset-sale" className="cursor-pointer text-[13px]">
                  {t('isAssetSale')}
                </Label>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cat-external-account">{t('externalAccountNumber')}</Label>
                <Input id="cat-external-account" value={externalAccountNumber} onChange={(e) => setExternalAccountNumber(e.target.value)} />
              </div>
            </div>
          </Disclosure>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button type="button" disabled={pending || !name || (!category && !key)} onClick={() => void submit()}>
            {tCommon('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
