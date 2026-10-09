'use client';

import { useState } from 'react';
import { FieldError } from '@/components/forms/field-error';
import { Segmented } from '@/components/ui/segmented';
import { useTranslations } from 'next-intl';
import { formatAmount, parseAmount } from '@/lib/finance/amount';

export interface AmountFieldProps {
  name: string;
  id?: string;
  /** Rohtext, deutsches Format — kontrolliert. */
  value: string;
  onChange: (text: string) => void;
  /** Fehlt der Umschalter, gibt es keine Richtung (z. B. eine „Wofür?“-Zeile). */
  direction?: 'in' | 'out';
  onDirectionChange?: (direction: 'in' | 'out') => void;
  /** 12-px-Zeile unter dem Feld — bei Kassen Pflicht. */
  balanceHint?: string;
  invalid?: boolean;
  disabled?: boolean;
  required?: boolean;
  /** Für „Wofür?“-Zeilen: ein negativer Betrag ist dort gültig (Gebühr, Rückerstattung). */
  allowNegative?: boolean;
  /** Ersetzt `finance.amount.format` — für einen Feldfehler, der kein Formatfehler ist (z. B. `exceeds`). */
  errorText?: string;
}

/**
 * Das Betragsfeld (HANDOFF § 2.1, Baustein 1): kontrolliert über den Rohtext,
 * formatiert erst beim Verlassen. Ein unlesbarer Text bleibt stehen; der
 * Fehlertext nennt das Format, nie „ungültig“.
 */
export function AmountField({ name, id, value, onChange, direction, onDirectionChange, balanceHint, invalid, disabled, required, allowNegative, errorText }: AmountFieldProps) {
  const t = useTranslations('finance.amount');
  const [blurredInvalid, setBlurredInvalid] = useState(false);
  const fieldId = id ?? name;
  const errorId = `${fieldId}-error`;
  const showError = invalid || blurredInvalid;

  const handleBlur = () => {
    const parsed = parseAmount(value);
    const bad = parsed === null || (parsed < 0 && !allowNegative);
    if (bad) {
      setBlurredInvalid(value.trim().length > 0);
      return;
    }
    setBlurredInvalid(false);
    onChange(formatAmount(parsed));
  };

  return (
    <div className="space-y-1">
      <div className="flex items-stretch gap-2">
        {direction !== undefined ? (
          <Segmented
            aria-label={t('directionGroup')}
            options={(['out', 'in'] as const).map((d) => ({ value: d, label: t(`direction.${d}`), disabled }))}
            value={direction}
            onValueChange={(d) => onDirectionChange?.(d)}
          />
        ) : null}
        {/* Feldrahmen im Fehlerzustand wie `ui/input`: aus `aria-invalid` am Feld, nicht aus einer eigenen Bedingung. */}
        <div className="flex h-[var(--field-h)] flex-1 items-stretch overflow-hidden rounded-md border border-line-strong bg-field has-[[aria-invalid=true]]:border-error">
          <input
            id={fieldId}
            name={name}
            type="text"
            inputMode="decimal"
            required={required}
            disabled={disabled}
            aria-invalid={showError || undefined}
            aria-describedby={showError ? errorId : undefined}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={handleBlur}
            className="w-full flex-1 bg-transparent px-2.5 text-right font-mono text-[length:var(--field-font)] tabular-nums outline-none"
          />
          <span className="flex items-center border-l border-line bg-surface-2 px-2.5 text-[13px] text-muted-ink" aria-hidden>
            €
          </span>
        </div>
      </div>
      {balanceHint ? <p className="text-[12px] text-muted-ink">{balanceHint}</p> : null}
      <FieldError id={errorId} message={showError ? (errorText ?? t('format')) : undefined} />
    </div>
  );
}
