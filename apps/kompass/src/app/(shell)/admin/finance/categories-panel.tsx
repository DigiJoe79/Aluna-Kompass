'use client';

import { useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { Disclosure } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/empty-state';
import { FilterBar } from '@/components/filter-bar';
import { SearchField } from '@/components/search-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useUrlFilters } from '@/lib/use-url-filters';
import { Select } from '@/components/ui/select';
import { RowButton, Table, TableBody, TableCell, TableGroupRow, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSavedVersions } from '@/lib/saved-versions';
import { confirmSetupStepAction, saveCategoryAction, setCategoryActiveAction, type CategoryInput } from './actions';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { useDateFormat } from '@/components/date-format-provider';
import { Section } from '@/components/section';
import { RowMenu } from '@/components/row-menu';
import { TAX_CODES } from '@kompass/module-finance/codes';

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
  /** Spendenplattform (Spec Teil J, St-L-9): bestätigt selbst bzw. wickelt nur ab; nur an Einnahmen. */
  donationPlatform?: 'confirmsItself' | 'handlesOnly' | null;
  allowanceKind: string;
  statementSuffices: boolean;
  defaultTaxCode: string;
  inputTaxDeductible: string;
  countsTowardTurnover: boolean;
  isAssetSale: boolean;
  /** Rechenschaft C: was die Freigrenze § 64 Abs. 3 AO nicht mitzählt (AEAO zu § 64 Nr. 17). */
  thresholdExclusion: 'none' | 'notPerformance' | 'taxRefund';
  externalAccountNumber: string | null;
  isActive: boolean;
}

const SPHERES = ['ideal', 'assetManagement', 'purposeOperation', 'business'] as const;
const INCOME_KINDS = ['donation', 'membershipFee', 'inKindDonation', 'expenseWaiver', 'bodyGrant', 'publicGrant', 'courtFine', 'sponsoring', 'sales', 'fees', 'interest', 'inheritance', 'other'] as const;
const COST_FUNCTIONS = ['program', 'administration', 'fundraising'] as const;
const DONATION_PLATFORMS = ['confirmsItself', 'handlesOnly'] as const;
const ALLOWANCE_KINDS = ['none', 'volunteer', 'trainer'] as const;
const INPUT_TAX = ['no', 'yes', 'partial'] as const;
const THRESHOLD_EXCLUSIONS = ['none', 'notPerformance', 'taxRefund'] as const;

/** H3 — gruppiert nach steuerlichem Bereich; Regelverstöße am Feld, „Erweitert“ als Disclosure. */
export function CategoriesPanel({ categories, confirmedAt }: { categories: CategoryRow[]; confirmedAt: string | null }) {
  const t = useTranslations('finance.admin.categories');
  const tMuted = useTranslations('common.muted');
  const tCommon = useTranslations('common');
  const fmt = useDateFormat();
  const router = useRouter();
  const [editing, setEditing] = useState<CategoryRow | null | 'new'>(null);
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startNavigation] = useTransition();
  // Gefiltert wird im Browser; die Suche steht trotzdem in der Adresse (`?panel=categories&text=`, Spec § 3).
  const [filters, setFilters] = useUrlFilters({ text: params.get('text') ?? '' });
  const search = filters.text.trim();
  const setSearch = (text: string) => {
    setFilters({ text });
    const next = new URLSearchParams(params.toString());
    if (text.trim()) next.set('text', text.trim());
    else next.delete('text');
    startNavigation(() => router.replace(`${pathname}?${next.toString()}`));
  };
  const [pending, setPending] = useState(false);
  const reviewFb = useActionFeedback();
  // Befund 43: Die Version aus der Speicher-Antwort gilt sofort (`useSavedVersions`).
  const versions = useSavedVersions();
  const openRow = (row: CategoryRow) => setEditing(versions.latest(row));

  const matches = useMemo(
    () => categories.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()) || c.key.toLowerCase().includes(search.toLowerCase())),
    [categories, search],
  );
  const grouped = useMemo(() => {
    const filtered = matches;
    const bySphere = new Map<string, CategoryRow[]>();
    for (const c of filtered) {
      const groupKey = c.direction === 'transit' ? 'transit' : (c.sphere ?? 'none');
      if (!bySphere.has(groupKey)) bySphere.set(groupKey, []);
      bySphere.get(groupKey)!.push(c);
    }
    return bySphere;
  }, [matches]);

  const confirmReviewed = async () => {
    setPending(true);
    const result = await reviewFb.run(() => confirmSetupStepAction('categories'), { retry: () => void confirmReviewed() });
    setPending(false);
    if (result.status !== 'success') return;
    router.refresh();
  };

  return (
    <section className="space-y-4" data-testid="categories-panel">
      <div className="flex flex-wrap items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <FilterBar
            search={<SearchField value={filters.text} onChange={setSearch} placeholder={t('searchPlaceholder')} />}
            searchActive={search ? { chip: search, onClear: () => setSearch('') } : undefined}
            filters={[]}
            count={{ shown: matches.length, total: categories.length, noun: { one: t('nounOne'), other: t('nounOther') } }}
            onReset={() => setSearch('')}
          />
        </div>
        {/* Runde 3, 168: „Kategorien durchgesehen“ als `outline` im Kopf der Liste neben „Kategorie anlegen“, wie in der
            Checkliste; der Stand steht darunter. Layout, kein Test. */}
        <Button variant="outline" disabled={pending} onClick={() => void confirmReviewed()} data-testid="review-categories">
          {t('review')}
        </Button>
        <Button onClick={() => setEditing('new')}>{t('create')}</Button>
      </div>
      <RefusalNotice action state={reviewFb.state} />
      <p className="text-meta text-muted-ink">{confirmedAt ? t('reviewedAt', { date: fmt.date(confirmedAt) }) : t('notReviewed')}</p>

      {/* Befund 6: Ohne Treffer verschwand alles ohne Text. Ohne Kategorien überhaupt gibt es die Seite nicht (Grundausstattung). */}
      {grouped.size === 0 && search ? <EmptyState filtered={{ noun: t('emptyNoun'), onReset: () => setSearch('') }} /> : null}

      {/* Eine Tabelle mit Gruppenzeilen je Bereich statt fünf Tabellen untereinander (11-1 B17). */}
      {grouped.size > 0 ? (
        <div className="overflow-hidden rounded-md border border-line">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead col="title">{t('columns.name')}</TableHead>
                <TableHead col="meta">{t('columns.direction')}</TableHead>
                <TableHead col="meta">{t('columns.statementSuffices')}</TableHead>
                {/* Zeilenaktionen im ⋯-Menü (Joe 11.8); der Kopf ist nur für Vorleser da (112). */}
                <TableHead col="actions" className="w-11"><span className="sr-only">{tCommon('rowActionsColumn')}</span></TableHead>
              </TableRow>
            </TableHeader>
            {[...grouped.entries()].map(([sphere, rows]) => (
              <TableBody key={sphere}>
                <TableGroupRow colSpan={4}>{t(`sphereGroup.${sphere}`)}</TableGroupRow>
                {rows.map((row) => (
                  <TableRow key={row.id} data-testid={`category-row-${row.key}`} muted={row.isActive ? undefined : tMuted('retired')}>
                    <TableCell col="title">
                      <RowButton aria-haspopup="dialog" onClick={() => openRow(row)}>{row.name}</RowButton>
                    </TableCell>
                    <TableCell col="meta" className="text-ink-2">{t(`directions.${row.direction}`)}</TableCell>
                    <TableCell col="meta" className="text-ink-2">{row.statementSuffices ? tCommon('yes') : tCommon('no')}</TableCell>
                    <TableCell col="actions" className="text-right">
                      <RowMenu name={row.name} items={[{ key: 'edit', label: tCommon('edit'), onSelect: () => openRow(row) }]} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            ))}
          </Table>
        </div>
      ) : null}

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
  const [donationPlatform, setDonationPlatform] = useState<'' | (typeof DONATION_PLATFORMS)[number]>(category?.donationPlatform ?? '');
  const [allowanceKind, setAllowanceKind] = useState(category?.allowanceKind ?? 'none');
  const [inputTaxDeductible, setInputTaxDeductible] = useState(category?.inputTaxDeductible ?? 'no');
  const [countsTowardTurnover, setCountsTowardTurnover] = useState(category?.countsTowardTurnover ?? false);
  const [isAssetSale, setIsAssetSale] = useState(category?.isAssetSale ?? false);
  const [thresholdExclusion, setThresholdExclusion] = useState<CategoryRow['thresholdExclusion']>(category?.thresholdExclusion ?? 'none');
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
      ...(direction === 'income' ? { donationPlatform: donationPlatform || null } : {}),
      allowanceKind,
      statementSuffices,
      defaultTaxCode,
      inputTaxDeductible,
      countsTowardTurnover,
      isAssetSale,
      thresholdExclusion,
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
          <DialogTitle>{category ? t('edit') : t('create')}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <Section title={t('sections.basics')}>
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
          </Section>
          <Section title={t('sections.tax')}>
            <FormGrid>
              <FormField id="cat-direction" label={t('columns.direction')} size="s">
                <Select id="cat-direction" value={direction} onChange={(e) => setDirection(e.target.value as CategoryRow['direction'])}>
                  <option value="income">{t('directions.income')}</option>
                  <option value="expense">{t('directions.expense')}</option>
                  <option value="transit">{t('directions.transit')}</option>
                </Select>
              </FormField>
              {direction !== 'transit' ? (
                <FormField id="cat-sphere" label={t('sphere')} required error={fieldErrors.sphere}>
                  <Select id="cat-sphere" value={sphere} onChange={(e) => setSphere(e.target.value as 'ideal' | 'assetManagement' | 'purposeOperation' | 'business' | '')} aria-invalid={!!fieldErrors.sphere}>
                    <option value="">{t('spherePlaceholder')}</option>
                    {SPHERES.map((s) => (
                      <option key={s} value={s}>
                        {t(`sphereGroup.${s}`)}
                      </option>
                    ))}
                  </Select>
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
          </Section>
          <div className="mt-5">
            <Disclosure label={t('advanced')} defaultOpen={fieldErrors.incomeKind !== undefined || fieldErrors.costFunction !== undefined || fieldErrors.donationPlatform !== undefined}>
              <div className="pt-1">
                <FormGrid>
                  {direction === 'income' ? (
                    <FormField id="cat-income-kind" label={t('incomeKind')} error={fieldErrors.incomeKind}>
                      <Select id="cat-income-kind" value={incomeKind} onChange={(e) => setIncomeKind(e.target.value)} aria-invalid={!!fieldErrors.incomeKind}>
                        <option value="">{t('spherePlaceholder')}</option>
                        {INCOME_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {t(`incomeKinds.${k}`)}
                          </option>
                        ))}
                      </Select>
                    </FormField>
                  ) : null}
                  {direction === 'income' ? (
                    <FormField id="cat-donation-platform" label={t('donationPlatform')} hint={t('donationPlatformHint')} error={fieldErrors.donationPlatform}>
                      <Select id="cat-donation-platform" value={donationPlatform} onChange={(e) => setDonationPlatform(e.target.value as typeof donationPlatform)} aria-invalid={!!fieldErrors.donationPlatform}>
                        <option value="">{t('donationPlatformNone')}</option>
                        {DONATION_PLATFORMS.map((p) => (
                          <option key={p} value={p}>
                            {t(`donationPlatforms.${p}`)}
                          </option>
                        ))}
                      </Select>
                    </FormField>
                  ) : null}
                  {direction === 'expense' ? (
                    <FormField id="cat-cost-function" label={t('costFunction')} error={fieldErrors.costFunction}>
                      <Select id="cat-cost-function" value={costFunction} onChange={(e) => setCostFunction(e.target.value)} aria-invalid={!!fieldErrors.costFunction}>
                        <option value="">{t('spherePlaceholder')}</option>
                        {COST_FUNCTIONS.map((c) => (
                          <option key={c} value={c}>
                            {t(`costFunctions.${c}`)}
                          </option>
                        ))}
                      </Select>
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
                  <FormField id="cat-threshold" label={t('thresholdExclusion')} hint={t('thresholdExclusionHint')} error={fieldErrors.thresholdExclusion} size="m">
                    <Select id="cat-threshold" value={thresholdExclusion} onChange={(e) => setThresholdExclusion(e.target.value as CategoryRow['thresholdExclusion'])}>
                      {THRESHOLD_EXCLUSIONS.map((v) => (
                        <option key={v} value={v}>
                          {t(`thresholdExclusions.${v}`)}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                </FormGrid>
              </div>
            </Disclosure>
          </div>
        </DialogBody>
        <FormActionBar placement="dialog" cancel={onClose} pending={pending} saveDisabled={!name || (!category && !key)} saveLabel={tCommon('save')} onSave={() => void submit()} state={withUnplacedFieldErrors(feedback.state, ['sphere', 'incomeKind', 'costFunction', 'donationPlatform', 'thresholdExclusion'])} />
      </DialogContent>
    </Dialog>
  );
}
