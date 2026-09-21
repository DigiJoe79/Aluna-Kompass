'use client';

import { MoreVertical } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ContactPicker, type PickedContact } from '@/components/contact-picker';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { formatEuro } from '@/lib/finance/amount';
import { cn } from '@/lib/utils';
import { AmountField } from './amount-field';

export interface SplitRowCategoryOption {
  id: string;
  name: string;
  direction: 'income' | 'expense';
  sphere: string;
  explanation?: string;
}
export interface SplitRowOption {
  id: string;
  name: string;
}
export interface SplitRowValue {
  key: string;
  categoryId: string;
  amountText: string;
  taxCode?: string;
  contactId: string | null;
  contactName?: string | null;
  projectId: string | null;
  purposeId: string | null;
  abroad: boolean;
  addsToAssets: boolean;
  locked?: boolean;
}

export interface SplitRowProps {
  value: SplitRowValue;
  onChange: (next: SplitRowValue) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onRestHere: () => void;
  onSplitEvenly: (n: number) => void;
  /** Für den Menüpunkt „Rest hierher — …“; `null`, solange kein Rest berechenbar ist. */
  restCents: number | null;
  categories: SplitRowCategoryOption[];
  purposes: SplitRowOption[];
  projects: SplitRowOption[];
  taxCodeOptions: string[];
  showTax: boolean;
  allowsAddsToAssets?: boolean;
  density?: 'default' | 'narrow';
  /** „Zweck im Minus“ — Warnung ohne Begründungsfeld. */
  purposeOverspent?: boolean;
  onFreeFundsRemainder?: () => void;
}

/**
 * Die Aufteilungszeile (HANDOFF § 2.4, Baustein 3): eine Karte mit bis zu
 * neun Feldern, zwei Reihen. `density="narrow"` ist ab jetzt Teil der Signatur
 * (F5), gebaut wird hier nur `default`.
 */
export function SplitRow({
  value,
  onChange,
  onRemove,
  onDuplicate,
  onRestHere,
  onSplitEvenly,
  restCents,
  categories,
  purposes,
  projects,
  taxCodeOptions,
  showTax,
  allowsAddsToAssets,
  density = 'default',
  purposeOverspent,
  onFreeFundsRemainder,
}: SplitRowProps) {
  const t = useTranslations('finance.splitRow');
  void density;
  const category = categories.find((c) => c.id === value.categoryId) ?? null;
  const purposeLabel = category?.direction === 'expense' ? t('purposePaidFrom') : t('purposeDeterminedBy');

  const set = (patch: Partial<SplitRowValue>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-3 rounded-md border border-line bg-surface-2 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1.2fr_repeat(3,1fr)_auto] sm:items-start">
        <div className="space-y-1">
          <Label htmlFor={`${value.key}-category`}>{t('category')}</Label>
          <select
            id={`${value.key}-category`}
            name={`${value.key}-category`}
            required
            disabled={value.locked}
            value={value.categoryId}
            onChange={(e) => set({ categoryId: e.target.value })}
            className="h-[var(--field-h)] w-full rounded-md border border-line-strong bg-field px-2.5 text-[13px]"
          >
            <option value="" disabled>
              {t('categoryPlaceholder')}
            </option>
            <optgroup label={t('income')}>
              {categories.filter((c) => c.direction === 'income').map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </optgroup>
            <optgroup label={t('expense')}>
              {categories.filter((c) => c.direction === 'expense').map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </optgroup>
          </select>
          {category ? (
            <p className="text-[11px] text-muted-ink">
              {t(`sphere.${category.sphere}`)}
              {category.explanation ? ` · ${category.explanation}` : ''}
            </p>
          ) : null}
        </div>

        <AmountField name={`${value.key}-amount`} value={value.amountText} onChange={(amountText) => set({ amountText })} allowNegative disabled={value.locked} required />

        {showTax ? (
          <div className="space-y-1">
            <Label htmlFor={`${value.key}-tax`}>{t('tax')}</Label>
            <select
              id={`${value.key}-tax`}
              name={`${value.key}-tax`}
              value={value.taxCode ?? ''}
              disabled={value.locked}
              onChange={(e) => set({ taxCode: e.target.value || undefined })}
              className="h-[var(--field-h)] w-full rounded-md border border-line-strong bg-field px-2.5 text-[13px]"
            >
              <option value="">{t('taxNone')}</option>
              {taxCodeOptions.map((code) => (
                <option key={code} value={code}>{t(`taxCode.${code}`)}</option>
              ))}
            </select>
          </div>
        ) : null}

        <ContactPicker
          id={`${value.key}-contact`}
          name={`${value.key}-contact`}
          label={t('contact')}
          value={value.contactId ? { id: value.contactId, name: value.contactName ?? '' } : null}
          onChange={(contact: PickedContact | null) => set({ contactId: contact?.id ?? null, contactName: contact?.name ?? null })}
        />

        <div className="space-y-1">
          <Label htmlFor={`${value.key}-project`}>{t('project')}</Label>
          <select
            id={`${value.key}-project`}
            name={`${value.key}-project`}
            value={value.projectId ?? ''}
            disabled={value.locked}
            onChange={(e) => set({ projectId: e.target.value || null })}
            className="h-[var(--field-h)] w-full rounded-md border border-line-strong bg-field px-2.5 text-[13px]"
          >
            <option value="">{t('none')}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        {value.locked ? null : (
          <DropdownMenu>
            <DropdownMenuTrigger aria-label={t('rowMenu')} className="mt-6 flex size-[var(--field-h)] items-center justify-center rounded-md border border-line-strong text-ink-2">
              <MoreVertical className="size-4" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-surface shadow-md">
              <DropdownMenuItem onSelect={onRestHere} disabled={restCents === null}>
                {restCents !== null ? t('restIntoHereWithAmount', { amount: formatEuro(restCents) }) : t('restIntoHere')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onSplitEvenly(2)}>{t('splitEvenly', { n: 2 })}</DropdownMenuItem>
              <DropdownMenuItem onSelect={onDuplicate}>{t('duplicate')}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onRemove}>{t('removeRow')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {purposes.length > 0 || allowsAddsToAssets ? (
        <div className={cn('grid grid-cols-1 gap-3 border-t border-line pt-3 sm:grid-cols-3')}>
          {purposes.length > 0 ? (
            <div className="space-y-1">
              <Label htmlFor={`${value.key}-purpose`}>{purposeLabel}</Label>
              <select
                id={`${value.key}-purpose`}
                name={`${value.key}-purpose`}
                value={value.purposeId ?? ''}
                onChange={(e) => set({ purposeId: e.target.value || null })}
                className="h-[var(--field-h)] w-full rounded-md border border-line-strong bg-field px-2.5 text-[13px]"
              >
                <option value="">{t('none')}</option>
                {purposes.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          ) : null}
          <label className="flex items-center gap-2 pt-6 text-[13px]">
            <Switch checked={value.abroad} onCheckedChange={(checked) => set({ abroad: checked === true })} />
            {t('abroad')}
          </label>
          {allowsAddsToAssets ? (
            <label className="flex items-center gap-2 pt-6 text-[13px]">
              <Switch checked={value.addsToAssets} onCheckedChange={(checked) => set({ addsToAssets: checked === true })} />
              {t('addsToAssets')}
            </label>
          ) : null}
        </div>
      ) : null}

      {purposeOverspent ? (
        <Notice level="warn" action={onFreeFundsRemainder ? <Button type="button" variant="secondary" size="sm" onClick={onFreeFundsRemainder}>{t('freeFundsRemainder')}</Button> : undefined}>
          {t('purposeOverspent')}
        </Notice>
      ) : null}
    </div>
  );
}
