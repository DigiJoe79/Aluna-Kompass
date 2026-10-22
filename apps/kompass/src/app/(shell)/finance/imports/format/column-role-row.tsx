'use client';

import { useTranslations } from 'next-intl';
import { Fragment } from 'react';
import { FormField } from '@/components/forms/form-field';
import { StatusBadge } from '@/components/status-badge';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { COLUMN_ROLES, splitValues, type AssistantState, type ColumnRole } from '@/lib/finance/csv-assistant-state';
import { breakableParts } from '@/lib/finance/csv-columns';
import { cn } from '@/lib/utils';

/**
 * Eine Spalte der Datei als Zeile im Schritt „Spalten“ (N2, Freigabe Joe 2026-10-22, Board CSV Spalten 1a–1f; lokal im
 * Assistenten, kein Baustein unter `components/`): Name, Beispielwerte, Auswahl der Rolle. Ohne Rolle eine Kurzzeile mit
 * einem Wert und gestrichelter Auswahl; mit Kennzeichen bzw. Status das Wertefeld unter der Auswahl.
 */
export function ColumnRoleRow({
  column,
  index,
  values,
  role,
  guessed,
  duplicate,
  compact,
  rowsCount,
  state,
  onRole,
  onValues,
}: {
  column: string;
  index: number;
  /** Verschiedene, nicht leere Werte der Vorschau (höchstens acht) — die Zeile zeigt ein bis zwei, der Hinweis alle. */
  values: string[];
  role: ColumnRole;
  guessed: boolean;
  duplicate: boolean;
  compact: boolean;
  rowsCount: number;
  state: AssistantState;
  onRole: (role: ColumnRole) => void;
  onValues: (field: 'indicatorValues' | 'pendingValues', value: string) => void;
}) {
  const t = useTranslations('finance.csvAssistant.columns');
  const shown = values.slice(0, compact ? 1 : 2);
  const valuesId = `csv-column-${index}-values`;
  const duplicateId = `csv-column-${index}-duplicate`;
  const valuesField = role === 'indicator' ? 'indicatorValues' : role === 'pending' ? 'pendingValues' : null;
  const fieldId = `csv-column-${index}-${valuesField ?? 'none'}`;
  const fieldValue = valuesField ? state[valuesField] : '';

  return (
    <li
      data-testid="csv-column"
      data-column={column}
      data-role={role}
      data-compact={compact ? 'true' : 'false'}
      // Board 1a–1f: ab `sm` Name 168 · Werte · Auswahl 216, darunter gestapelt; Kurzzeile mit weniger Polster.
      className={cn('grid gap-x-4 gap-y-2 bg-surface px-4 sm:grid-cols-[168px_minmax(0,1fr)_216px] sm:items-start', compact ? 'py-2' : 'py-3')}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 sm:flex-col sm:items-start sm:pt-2">
        <span className={cn('break-words', compact ? 'text-ink-2' : 'font-semibold text-ink')}>{column}</span>
        {guessed ? <StatusBadge tone="agent">{t('guessed')}</StatusBadge> : null}
      </div>
      {/* Der volle Wert für Vorleser über `aria-describedby` der Auswahl; sichtbar höchstens zwei Zeilen je Wert. */}
      <div id={valuesId} className="flex min-w-0 flex-col gap-0.5 sm:pt-2">
        {shown.length === 0 ? (
          <span className="text-meta text-muted-ink">{t('empty', { rows: rowsCount })}</span>
        ) : (
          shown.map((value) => (
            <span key={value} className="line-clamp-2 font-mono text-meta break-words text-ink-2">
              {breakableParts(value).map((part, i) => (
                <Fragment key={i}>
                  {i > 0 ? <wbr /> : null}
                  {part}
                </Fragment>
              ))}
            </span>
          ))
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <Select
          aria-label={t('roleLabel', { column })}
          aria-describedby={[valuesId, duplicate ? duplicateId : ''].filter(Boolean).join(' ')}
          aria-invalid={duplicate || undefined}
          className={cn(compact && 'border-dashed text-muted-ink')}
          value={role}
          onChange={(e) => onRole(e.target.value as ColumnRole)}
        >
          {COLUMN_ROLES.map((option) => (
            <option key={option} value={option}>
              {t(`roles.${option}`)}
            </option>
          ))}
        </Select>
        {duplicate ? (
          <p id={duplicateId} className="text-meta text-error">
            {t('reasons.duplicateRole')}
          </p>
        ) : null}
      </div>
      {valuesField ? (
        <div className="rounded-md bg-surface-2 px-3.5 py-3 sm:col-span-2 sm:col-start-2">
          <FormField
            id={fieldId}
            label={t(valuesField)}
            hint={values.length > 0 ? t('valuesHint', { values: values.join(', ') }) : t('valuesHintPlain')}
          >
            <Input id={fieldId} aria-invalid={splitValues(fieldValue).length === 0 || undefined} value={fieldValue} onChange={(e) => onValues(valuesField, e.target.value)} />
          </FormField>
        </div>
      ) : null}
    </li>
  );
}
