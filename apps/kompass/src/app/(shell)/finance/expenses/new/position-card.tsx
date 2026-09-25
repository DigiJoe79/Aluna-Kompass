'use client';

import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Ref } from 'react';
import { AmountField } from '@/components/finance/amount-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatEuro } from '@/lib/finance/amount';
import { rateAt, tripCalculation, type Device, type MileageRate, type PositionForm } from '@/lib/finance/expenses';
import { cn } from '@/lib/utils';
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
  firstFieldRef?: Ref<HTMLInputElement>;
  pdf: { uploading: boolean; error: PdfFieldError | null; device: Device; maxBytes: number; onPick: (file: File) => void };
}

function FieldError({ text }: { text?: string }) {
  return text ? <p className="text-[12px] text-error">{text}</p> : null;
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
        <h3 className="text-[13px] font-semibold text-muted-ink">{t('position', { n })}</h3>
        {canRemove ? (
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t('removePosition', { n })} onClick={onRemove}>
            <Trash2 aria-hidden />
          </Button>
        ) : null}
      </div>

      <div role="radiogroup" aria-label={t('kind.group', { n })} className="grid grid-cols-2 gap-1 rounded-md border border-line-strong bg-surface-2 p-1">
        {(['receipt', 'trip'] as const).map((kind) => (
          <label
            key={kind}
            className={cn(
              'relative flex h-11 cursor-pointer items-center justify-center rounded-sm text-[14px] font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
              p.kind === kind ? 'bg-selected text-selected-ink' : 'text-ink-2',
            )}
          >
            <input
              ref={kind === 'receipt' ? firstFieldRef : undefined}
              type="radio"
              name={id('kind')}
              value={kind}
              checked={p.kind === kind}
              onChange={() => onChange({ kind })}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
            {t(`kind.${kind}`)}
          </label>
        ))}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={id('date')}>{t('date')}</Label>
        <Input id={id('date')} type="date" value={p.positionDate} aria-invalid={!!errors.positionDate || undefined} onChange={(e) => onChange({ positionDate: e.target.value })} />
        <FieldError text={errors.positionDate} />
      </div>

      {p.kind === 'receipt' ? (
        <>
          <div className="space-y-1.5">
            <Label htmlFor={id('amount')}>{t('amount')}</Label>
            <AmountField name={id('amount')} value={p.amountText} invalid={!!errors.amountCents} onChange={(amountText) => onChange({ amountText })} />
            <FieldError text={errors.amountCents} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={id('purpose')}>{t('purpose')}</Label>
            <Input id={id('purpose')} value={p.purpose} aria-invalid={!!errors.purpose || undefined} onChange={(e) => onChange({ purpose: e.target.value })} />
            <FieldError text={errors.purpose} />
          </div>
          {projects && projects.length > 0 ? (
            <div className="space-y-1.5">
              <Label htmlFor={id('project')}>
                {t('project')} <span className="font-normal text-muted-ink">({t('optional')})</span>
              </Label>
              <Select id={id('project')} value={p.projectId} onChange={(e) => onChange({ projectId: e.target.value })}>
                <option value="">{t('projectNone')}</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          <PdfField positionKey={p.key} fileName={p.fileName} fileSize={p.fileSize} documentNumber={p.documentNumber} {...pdf} />
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={id('from')}>{t('tripFrom')}</Label>
              <Input id={id('from')} value={p.tripFrom} onChange={(e) => onChange({ tripFrom: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={id('to')}>{t('tripTo')}</Label>
              <Input id={id('to')} value={p.tripTo} onChange={(e) => onChange({ tripTo: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={id('reason')}>{t('tripReason')}</Label>
            <Input id={id('reason')} value={p.tripReason} onChange={(e) => onChange({ tripReason: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={id('km')}>{t('km')}</Label>
            <Input id={id('km')} inputMode="numeric" value={p.kmText} onChange={(e) => onChange({ kmText: e.target.value })} />
            <p data-testid="trip-calculation" aria-live="polite" className="font-mono text-[14px] tabular-nums text-ink-2">
              {trip
                ? t.rich('tripCalculation', { km: trip.km, rate: formatEuro(trip.centsPerKm), amount: formatEuro(trip.amountCents), b: (chunks) => <b className="text-ink">{chunks}</b> })
                : p.positionDate && rateAt(rates, p.positionDate) === null
                  ? t('tripNoRate')
                  : null}
            </p>
          </div>
        </>
      )}
    </li>
  );
}
