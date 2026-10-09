'use client';

import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Ref } from 'react';
import { AmountField } from '@/components/finance/amount-field';
import { FormField } from '@/components/forms/form-field';
import { FormCell, FormGrid, FormRowBreak } from '@/components/forms/form-grid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { formatEuro } from '@/lib/finance/amount';
import { rateAt, tripCalculation, type Device, type MileageRate, type PositionForm } from '@/lib/finance/expenses';
import { PdfField, type PdfFieldError } from './pdf-field';

export interface PositionCardProps {
  position: PositionForm;
  n: number;
  rates: readonly MileageRate[];
  projects: { id: string; name: string }[] | null;
  errors: Record<string, string>;
  canRemove: boolean;
  onChange: (patch: Partial<PositionForm>) => void;
  onRemove: () => void;
  /** Hülle des Umschalters Beleg/Fahrt; das Formular fokussiert darin die gewählte Option. */
  firstFieldRef?: Ref<HTMLDivElement>;
  pdf: { uploading: boolean; error: PdfFieldError | null; device: Device; maxBytes: number; onPick: (file: File) => void };
}

/**
 * Eine Position als Karte (Designer-README 3a): oben der Umschalter Beleg /
 * Fahrt als Radiogruppe (44 px, Pfeiltasten wie jede Radiogruppe), darunter
 * die Felder der Art. Die Fahrtrechnung ist nicht editierbar und wird
 * vorgelesen, wenn sie sich ändert.
 */
export function PositionCard({ position: p, n, rates, projects, errors, canRemove, onChange, onRemove, firstFieldRef, pdf }: PositionCardProps) {
  const t = useTranslations('finance.expenses.new');
  const id = (field: string) => `${p.key}-${field}`;
  const trip = p.kind === 'trip' ? tripCalculation(p.kmText, p.positionDate, rates) : null;

  return (
    <li data-testid="expense-position" className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold">{t('position', { n })}</h3>
        {canRemove ? (
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t('removePosition', { n })} onClick={onRemove}>
            <Trash2 aria-hidden />
          </Button>
        ) : null}
      </div>

      <FormGrid>
        <FormCell size="m">
          {/* Die Hülle trägt den Ref: Das Formular setzt den Fokus auf die gewählte Option einer neuen Position. */}
          <div ref={firstFieldRef}>
            <Segmented
              aria-label={t('kind.group', { n })}
              options={(['receipt', 'trip'] as const).map((kind) => ({ value: kind, label: t(`kind.${kind}`) }))}
              value={p.kind}
              onValueChange={(kind) => onChange({ kind })}
            />
          </div>
        </FormCell>
        <FormRowBreak />

        <FormField id={id('date')} label={t('date')} error={errors.positionDate} size="s">
          <Input id={id('date')} type="date" value={p.positionDate} onChange={(e) => onChange({ positionDate: e.target.value })} />
        </FormField>

        {p.kind === 'receipt' ? (
          <>
            <FormField id={id('amount')} label={t('amount')} size="s">
              <AmountField name={id('amount')} value={p.amountText} invalid={!!errors.amountCents} errorText={errors.amountCents} onChange={(amountText) => onChange({ amountText })} />
            </FormField>
            {projects && projects.length > 0 ? (
              <FormField id={id('project')} label={`${t('project')} (${t('optional')})`}>
                <Select id={id('project')} value={p.projectId} onChange={(e) => onChange({ projectId: e.target.value })}>
                  <option value="">{t('projectNone')}</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </Select>
              </FormField>
            ) : null}
            <FormField id={id('purpose')} label={t('purpose')} error={errors.purpose}>
              <Input id={id('purpose')} value={p.purpose} onChange={(e) => onChange({ purpose: e.target.value })} />
            </FormField>
            <FormCell size="full">
              <PdfField positionKey={p.key} fileName={p.fileName} fileSize={p.fileSize} pageCount={p.pageCount} documentNumber={p.documentNumber} {...pdf} />
            </FormCell>
          </>
        ) : (
          <>
            <FormField id={id('km')} label={t('km')} size="s">
              <Input id={id('km')} inputMode="numeric" value={p.kmText} onChange={(e) => onChange({ kmText: e.target.value })} />
            </FormField>
            <FormField id={id('reason')} label={t('tripReason')}>
              <Input id={id('reason')} value={p.tripReason} onChange={(e) => onChange({ tripReason: e.target.value })} />
            </FormField>
            <FormField id={id('from')} label={t('tripFrom')}>
              <Input id={id('from')} value={p.tripFrom} onChange={(e) => onChange({ tripFrom: e.target.value })} />
            </FormField>
            <FormField id={id('to')} label={t('tripTo')}>
              <Input id={id('to')} value={p.tripTo} onChange={(e) => onChange({ tripTo: e.target.value })} />
            </FormField>
            <FormCell as="p" data-testid="trip-calculation" aria-live="polite" size="full" className="font-mono text-[14px] tabular-nums text-ink-2">
              {trip
                ? t.rich('tripCalculation', { km: trip.km, rate: formatEuro(trip.centsPerKm), amount: formatEuro(trip.amountCents), b: (chunks) => <b className="text-ink">{chunks}</b> })
                : p.positionDate && rateAt(rates, p.positionDate) === null
                  ? t('tripNoRate')
                  : null}
            </FormCell>
          </>
        )}
      </FormGrid>
    </li>
  );
}
