'use client';

import { withoutReverseChargeSentences } from '@/lib/finance/reverse-charge-prompt';
import { keepSectionSign } from '@kompass/module-finance/format';
import { MoreVertical } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { FieldError } from '@/components/forms/field-error';
import { ContactPicker, type PickedContact } from '@/components/contact-picker';
import { Notice } from '@/components/notice';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { Button, buttonVariants } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { formatEuro, parseAmount } from '@/lib/finance/amount';
import { isReverseChargeCode, reverseChargeLineFacts, type VatLineContext } from '@/lib/finance/reverse-charge-text';
import { vatPeriodLabel } from '@/lib/finance/vat-period';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { AmountField } from './amount-field';

export interface SplitRowCategoryOption {
  id: string;
  name: string;
  direction: 'income' | 'expense';
  sphere: string;
  /** Einnahmeart: `bodyGrant` erlaubt die Vermögensausstattung, `inheritance` führt dem Vermögen zu (Anlage Gem, 15g). */
  incomeKind?: string | null;
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
  /** Satzart der Zeile (Vorgabe Regelsatz) — für den Satz zur Steuer bei § 13b/Erwerb. */
  rateKind?: 'standard' | 'reduced';
  contactId: string | null;
  contactName?: string | null;
  projectId: string | null;
  purposeId: string | null;
  abroad: boolean;
  addsToAssets: boolean;
  /** Vermögensausstattung nach § 58 Nr. 3 AO von einer anderen Körperschaft (nur bei `bodyGrant`). */
  assetEndowment?: boolean;
  /** Nicht dem Vermögen zuführen — der feste Grund je Art (Erbschaft: Erblasser, Ausstattung: Geber). */
  addsToAssetsOptOut?: 'testatorDirectedCurrentUse' | 'donorAllowedCurrentUse' | null;
  locked?: boolean;
  /** § 13b/Erwerb (E6a Task 11c): Tag der Leistung, bei „§ 13b, übrige“ der Rechnung — nur bei diesen Kennzeichen. */
  serviceDate?: string | null;
  /** Woher das Kennzeichen kam — nur Anzeige, nie gespeichert; eine Hand-Änderung löscht sie. */
  taxCodeOrigin?: 'contact' | 'prompt' | null;
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
  /** Die Prüffrage § 13b steht über den Zeilen: Die Hilfezeile der Kategorie wiederholt sie nicht (Designer Runde 8, 9c). */
  reverseChargeAsked?: boolean;
  allowsAddsToAssets?: boolean;
  density?: 'default' | 'narrow';
  /** Nummer der Zeile ab 1, links im Kopf der Zeilenkarte („Zeile 2“). */
  position: number;
  /** „Zweck im Minus“ — Warnung ohne Begründungsfeld. */
  purposeOverspent?: boolean;
  onFreeFundsRemainder?: () => void;
  /** Feldfehler der Zeile, schon übersetzt (Meldungsregel A: am Feld und oben in `FormErrorSummary`). */
  errors?: { categoryId?: string; amountText?: string; serviceDate?: string; taxCode?: string };
  /** Für den Satz zur Steuer bei § 13b/Erwerb (Board Umsatzsteuer 3a): Besteuerung, Sätze und Zeitraumarten von heute. */
  vatContext?: VatLineContext;
  /** Der Buchungstag der Maske — Zeitraum der Buchung im Satz. */
  entryDate?: string;
  /** Richtung der Zeile, solange keine Kategorie gewählt ist (Vorlage der Maske bzw. Vorzeichen des Umsatzes). */
  defaultDirection?: 'income' | 'expense';
}

/**
 * Die Aufteilungszeile (HANDOFF § 2.4, Baustein 3): eine Karte mit bis zu
 * neun Feldern, zwei Reihen. `density="narrow"` (F5, HANDOFF § 12.2) für die
 * Mini-Maske der Arbeitsliste: gleiche Felder, gleiche Reihenfolge, gleiches
 * Zeilenmenü — nur umgebrochen (Kategorie; Betrag und Umsatzsteuer; Empfänger;
 * Projekt; abgesetzt Zweck und Ausland). Die Erklärzeilen bleiben sichtbar.
 */
export function SplitRow({
  value,
  onChange,
  onRemove,
  onDuplicate,
  onRestHere,
  onSplitEvenly,
  position,
  restCents,
  categories,
  purposes,
  projects,
  taxCodeOptions,
  showTax,
  reverseChargeAsked = false,
  allowsAddsToAssets,
  density = 'default',
  purposeOverspent,
  onFreeFundsRemainder,
  errors,
  vatContext,
  entryDate,
  defaultDirection,
}: SplitRowProps) {
  const t = useTranslations('finance.splitRow');
  const tRoot = useTranslations();
  const narrow = density === 'narrow';
  const category = categories.find((c) => c.id === value.categoryId) ?? null;
  const explanation = category?.explanation ? (reverseChargeAsked ? withoutReverseChargeSentences(category.explanation) : category.explanation) : '';
  const purposeLabel = category?.direction === 'expense' ? t('purposePaidFrom') : t('purposeDeterminedBy');

  const set = (patch: Partial<SplitRowValue>) => onChange({ ...value, ...patch });
  // Anlage Gem (15g): Ausstattung nur bei einer Zuwendung einer anderen Organisation; Erbschaft und Ausstattung gehen ins
  // Vermögen, außer der feste Grund erlaubt die laufende Verwendung — kein freies Textfeld, der Grund liegt rechtlich fest.
  const endowmentPossible = category?.direction === 'income' && category.incomeKind === 'bodyGrant';
  const toAssetsKind = category?.direction === 'income' && category.incomeKind === 'inheritance' ? 'inheritance' : endowmentPossible && value.assetEndowment ? 'endowment' : null;
  const optOutReason = toAssetsKind === 'inheritance' ? 'testatorDirectedCurrentUse' : 'donorAllowedCurrentUse';
  // Ohne Unternehmereigenschaft bietet die Maske nur Kennzeichen für Einkäufe (§ 13b, Erwerb): Das Feld steht dann nur an
  // Ausgabezeilen — Richtung der Kategorie, sonst der Maske (Befund 39, Frage 1). Ein gesetztes Kennzeichen bleibt sichtbar.
  const direction = category?.direction ?? defaultDirection;
  const purchaseCodesOnly = taxCodeOptions.length > 0 && taxCodeOptions.every(isReverseChargeCode);
  const taxShown = showTax && (!purchaseCodesOnly || direction === 'expense' || (!!value.taxCode && value.taxCode !== 'none'));
  // E6a Task 11c (Board 3a): Leistungsdatum nur bei § 13b und Erwerb; bei „§ 13b, übrige“ heißt es Rechnungsdatum (Joe, Frage 1).
  const reverseCharge = taxShown && isReverseChargeCode(value.taxCode);
  // Ein Kennzeichen, das die Lage von heute nicht mehr anbietet (früher Unternehmer, Vorgabe vom Kontakt oder aus der
  // E-Rechnung), bleibt wählbar, statt still als „keine“ zu erscheinen (Befund 37).
  const codes = value.taxCode && value.taxCode !== 'none' && !taxCodeOptions.includes(value.taxCode) ? [...taxCodeOptions, value.taxCode] : taxCodeOptions;
  const serviceLabel = value.taxCode === 'rc13bOther' ? t('invoiceDate') : t('serviceDate');
  const facts = reverseCharge && vatContext && entryDate ? reverseChargeLineFacts({ amountCents: parseAmount(value.amountText) ?? 0, taxCode: value.taxCode, rateKind: value.rateKind ?? 'standard', entryDate, serviceDate: value.serviceDate ?? null, context: vatContext }) : null;
  const periodText = (key: string) => vatPeriodLabel(key, tRoot);
  const vatSentence = facts
    ? [
        facts.servicePeriod !== null && facts.servicePeriod !== facts.entryPeriod
          ? t('vatSentenceSplit', { tax: formatEuro(facts.taxCents), rate: String(facts.ratePercent), base: formatEuro(facts.baseCents), kind: value.taxCode === 'rc13bOther' ? 'invoice' : 'service', serviceMonth: t('monthName', { month: (value.serviceDate ?? '').slice(5, 7) }), entryMonth: t('monthName', { month: (entryDate ?? '').slice(5, 7) }), period: periodText(facts.period) })
          : t('vatSentence', { tax: formatEuro(facts.taxCents), rate: String(facts.ratePercent), base: formatEuro(facts.baseCents), period: periodText(facts.period) }),
        facts.noInputTax ? t('vatNoInputTax') : null,
      ].filter(Boolean).join(' ')
    : null;

  return (
    // 07-1 B15 · 07-2 B16: Die Zeile ist keine graue Karte in der Formularkarte (§ E) — nur eine Linie trennt sie.
    <div data-testid="split-row" data-density={density} className="space-y-3 border-t border-line pt-3">
      {/* Kopf der Zeilenkarte: links „Zeile n“, rechts das Zeilenmenü — in breiter und schmaler Spalte gleich,
          32 px hoch, keine leere Zeile mit nur dem Menü (HANDOFF Konsistenz § 8c). */}
      <div className="-mt-1 -mr-1 flex h-8 items-center justify-between gap-2">
        <span className="text-hint font-semibold text-muted-ink">{t('rowLabel', { n: position })}</span>
        {value.locked ? null : (
          <DropdownMenu>
            <DropdownMenuTrigger aria-label={t('rowMenu')} className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}>
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
      {/* Kategorie und Spender/Empfänger gleich breit (Designer Runde 8, 9c: „Hilfswerk Interr“ war abgeschnitten); reicht
          es nicht, kürzt das Feld mit Tooltip. Kein Layout-Test (Einzelstelle). */}
      <div className={cn('grid gap-3', narrow ? 'grid-cols-2 items-start' : taxShown ? 'grid-cols-1 sm:grid-cols-[2fr_1.2fr_1fr_2fr_1fr] sm:items-start' : 'grid-cols-1 sm:grid-cols-[2fr_1.2fr_2fr_1fr] sm:items-start')}>
        <div className={cn('space-y-1', narrow && 'col-span-2')}>
          {/* Runde 3, 087: Kategorie und Betrag sind Pflicht und tragen den Stern; die Legende setzt die Leiste der Maske.
              Die schmale Form der Arbeitsliste hat keine Speicherleiste und keine Sterne. */}
          <Label htmlFor={`${value.key}-category`} required={!narrow}>{t('category')}</Label>
          <Select
            id={`${value.key}-category`}
            name={`${value.key}-category`}
            required
            disabled={value.locked}
            value={value.categoryId}
            onChange={(e) => set({ categoryId: e.target.value })}
            aria-invalid={errors?.categoryId ? true : undefined}
            aria-describedby={errors?.categoryId ? `${value.key}-category-error` : undefined}
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
          </Select>
          {category ? (
            <p className="text-hint text-muted-ink">
              {t(`sphere.${category.sphere}`)}
              {explanation ? ` · ${keepSectionSign(explanation)}` : ''}
            </p>
          ) : null}
          <FieldError id={`${value.key}-category-error`} message={errors?.categoryId} />
        </div>

        <div className={cn('space-y-1', narrow && !taxShown && 'col-span-2', narrow && 'row-start-2')}>
          <Label htmlFor={`${value.key}-amount`} required={!narrow}>{t('amount')}</Label>
          <AmountField id={`${value.key}-amount`} name={`${value.key}-amount`} value={value.amountText} onChange={(amountText) => set({ amountText })} allowNegative disabled={value.locked} required invalid={!!errors?.amountText} errorText={errors?.amountText} />
        </div>

        {taxShown ? (
          <div className={cn('space-y-1', narrow && 'row-start-2')}>
            <Label htmlFor={`${value.key}-tax`}>{t('tax')}</Label>
            <Select
              id={`${value.key}-tax`}
              name={`${value.key}-tax`}
              value={value.taxCode ?? ''}
              disabled={value.locked}
              aria-invalid={errors?.taxCode ? true : undefined}
              aria-describedby={errors?.taxCode ? `${value.key}-tax-error` : undefined}
              // Eine Hand-Änderung löscht die Herkunft; ein anderes Kennzeichen leert das Leistungsdatum (Task 11c).
              onChange={(e) => set({ taxCode: e.target.value || undefined, taxCodeOrigin: null, ...(e.target.value !== value.taxCode ? { serviceDate: null } : {}) })}
            >
              <option value="">{t('taxNone')}</option>
              {codes.filter((code) => !isReverseChargeCode(code)).map((code) => (
                <option key={code} value={code}>{t(`taxCode.${code}`)}</option>
              ))}
              {codes.some(isReverseChargeCode) ? (
                <optgroup label={t('taxOwedGroup')}>
                  {codes.filter(isReverseChargeCode).map((code) => (
                    <option key={code} value={code}>{t(`taxCode.${code}`)}</option>
                  ))}
                </optgroup>
              ) : null}
            </Select>
            {value.taxCodeOrigin ? <p className="text-hint text-muted-ink" data-tax-origin={value.taxCodeOrigin}>{t(`taxOrigin.${value.taxCodeOrigin}`)}</p> : null}
            <FieldError id={`${value.key}-tax-error`} message={errors?.taxCode} />
          </div>
        ) : null}

        <div className={cn(narrow && 'col-span-2')}>
        <ContactPicker
          id={`${value.key}-contact`}
          name={`${value.key}-contact`}
          label={t('contact')}
          value={value.contactId ? { id: value.contactId, name: value.contactName ?? '' } : null}
          onChange={(contact: PickedContact | null) => set({ contactId: contact?.id ?? null, contactName: contact?.name ?? null })}
        />
        </div>

        <div className={cn('space-y-1', narrow && 'col-span-2')}>
          <Label htmlFor={`${value.key}-project`}>{t('project')}</Label>
          <Select
            id={`${value.key}-project`}
            name={`${value.key}-project`}
            value={value.projectId ?? ''}
            disabled={value.locked}
            onChange={(e) => set({ projectId: e.target.value || null })}
          >
            <option value="">{t('noProject')}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        </div>

      </div>

      {purposes.length > 0 || allowsAddsToAssets || endowmentPossible || toAssetsKind || reverseCharge ? (
        // 07-2 B17: Zweck und Schalter im `FormGrid` statt eines handgebauten Rasters; der Schalter bleibt `FormField toggle`.
        <div className="border-t border-line pt-3">
        <FormGrid>
          {purposes.length > 0 ? (
            <FormField id={`${value.key}-purpose`} label={purposeLabel}>
              <Select
                id={`${value.key}-purpose`}
                name={`${value.key}-purpose`}
                value={value.purposeId ?? ''}
                onChange={(e) => set({ purposeId: e.target.value || null })}
              >
                <option value="">{t('noPurpose')}</option>
                {purposes.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            </FormField>
          ) : null}
          {reverseCharge ? (
            <FormField id={`${value.key}-service-date`} label={serviceLabel} error={errors?.serviceDate} size="s">
              <Input id={`${value.key}-service-date`} type="date" value={value.serviceDate ?? ''} disabled={value.locked} onChange={(e) => set({ serviceDate: e.target.value || null })} />
            </FormField>
          ) : null}
          <FormField id={`${value.key}-abroad`} label={t('abroad')} toggle size="s">
            <Switch id={`${value.key}-abroad`} checked={value.abroad} onCheckedChange={(checked) => set({ abroad: checked === true })} />
          </FormField>
          {allowsAddsToAssets ? (
            <FormField id={`${value.key}-adds-to-assets`} label={t('addsToAssets')} toggle size="s">
              <Switch id={`${value.key}-adds-to-assets`} checked={value.addsToAssets} onCheckedChange={(checked) => set({ addsToAssets: checked === true })} />
            </FormField>
          ) : null}
          {endowmentPossible ? (
            <FormField id={`${value.key}-asset-endowment`} label={t('assetEndowment')} hint={t('assetEndowmentHint')} toggle size="l">
              <Checkbox id={`${value.key}-asset-endowment`} checked={value.assetEndowment === true} disabled={value.locked} onCheckedChange={(on) => set({ assetEndowment: on === true, ...(on === true ? {} : { addsToAssetsOptOut: value.addsToAssetsOptOut === 'donorAllowedCurrentUse' ? null : value.addsToAssetsOptOut }) })} />
            </FormField>
          ) : null}
          {toAssetsKind ? (
            <FormField id={`${value.key}-not-to-assets`} label={t('notToAssets')} hint={t(`notToAssetsReason.${optOutReason}`)} toggle size="l">
              <Checkbox id={`${value.key}-not-to-assets`} checked={value.addsToAssetsOptOut === optOutReason} disabled={value.locked} onCheckedChange={(on) => set(on === true ? { addsToAssetsOptOut: optOutReason, addsToAssets: false } : { addsToAssetsOptOut: null, addsToAssets: true })} />
            </FormField>
          ) : null}
        </FormGrid>
        </div>
      ) : null}

      {vatSentence ? (
        <p className="text-meta text-ink-2" data-testid="split-row-vat-sentence">{vatSentence}</p>
      ) : null}

      {purposeOverspent ? (
        <Notice level="warn" action={onFreeFundsRemainder ? <Button type="button" variant="outline" size="sm" onClick={onFreeFundsRemainder}>{t('freeFundsRemainder')}</Button> : undefined}>
          {t('purposeOverspent')}
        </Notice>
      ) : null}
    </div>
  );
}
