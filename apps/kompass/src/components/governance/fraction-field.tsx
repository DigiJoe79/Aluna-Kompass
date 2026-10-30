'use client';

import { useTranslations } from 'next-intl';
import { CountField } from '@/components/count-field';
import { FieldError } from '@/components/forms/field-error';
import { Select } from '@/components/ui/select';
import { exampleNeeded, type FractionFieldBase, type FractionValue } from '@/lib/governance/fraction';

export interface FractionFieldBaseOption {
  value: FractionFieldBase;
  label: string;
  /** Heutige Zahl der Bezugsgröße; ohne Zahl kein Beispiel. */
  sample: number | null;
  /** „Bei 13 abgegebenen Stimmen“. */
  sampleLabel: string;
}

/**
 * Bruchfeld (N8, Board Gremien Phase 2 5c, Freigabe Joe 2026-10-28): „[mindestens|mehr als] [n]/[m] [Bezugsgröße]“ in
 * einer Zeile, darunter das Ergebnis für die heutige Zahl in `muted`. Rechnet über `fractionNeeded` des Moduls. Zähler
 * über Nenner ist ein Feldfehler, kein Sperren.
 */
export function FractionField({
  id,
  label,
  value,
  onChange,
  bases,
  unit,
  error,
  describedBy,
  hideLabel,
}: {
  id: string;
  label: string;
  value: FractionValue;
  onChange: (v: FractionValue) => void;
  bases: FractionFieldBaseOption[];
  unit?: 'yes' | 'present';
  error?: string;
  describedBy?: string;
  /** Die Beschriftung steht schon daneben (Regelzeile): nur für Vorleser. */
  hideLabel?: boolean;
}) {
  const t = useTranslations('governance.fraction');
  const labelId = `${id}-label`;
  const errorId = `${id}-error`;
  const above = value.num > value.den;
  const ownError = above ? t('aboveOne') : undefined;
  const base = bases.find((b) => b.value === value.base) ?? null;
  const sample = !above && base && base.sample !== null && value.den > 0 ? t(unit === 'yes' ? 'exampleYes' : 'example', { label: base.sampleLabel, needed: exampleNeeded(value, base.sample) }) : '';
  const number = (raw: string) => Math.max(0, Math.trunc(Number(raw) || 0));
  const describe = [error || ownError ? errorId : null, describedBy].filter(Boolean).join(' ') || undefined;
  return (
    <div role="group" aria-labelledby={labelId} className="flex min-w-0 flex-col gap-1">
      <span id={labelId} className={hideLabel ? 'sr-only' : 'text-meta font-semibold text-ink'}>
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <Select id={`${id}-comparison`} aria-label={t('comparison')} className="w-auto" value={value.comparison} onChange={(e) => onChange({ ...value, comparison: e.target.value as FractionValue['comparison'] })}>
          <option value="atLeast">{t('atLeast')}</option>
          <option value="moreThan">{t('moreThan')}</option>
        </Select>
        <span className="inline-flex items-center gap-2">
          <CountField id={`${id}-num`} aria-label={t('numerator')} aria-invalid={above || undefined} aria-describedby={describe} min={1} max={100} value={value.num} onChange={(e) => onChange({ ...value, num: number(e.target.value) })} />
          <span aria-hidden>/</span>
          <CountField id={`${id}-den`} aria-label={t('denominator')} min={1} max={100} value={value.den} onChange={(e) => onChange({ ...value, den: number(e.target.value) })} />
        </span>
        <Select id={`${id}-base`} aria-label={t('base')} className="w-auto max-w-full" value={value.base} onChange={(e) => onChange({ ...value, base: e.target.value as FractionValue['base'] })}>
          {bases.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </Select>
      </div>
      <FieldError id={errorId} message={error ?? ownError} />
      <p aria-live="polite" className="text-meta text-muted-ink">
        {sample}
      </p>
    </div>
  );
}
