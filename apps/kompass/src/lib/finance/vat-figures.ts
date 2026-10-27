import { keepSectionSign } from '@kompass/module-finance/format';
import { euroBase, vatFormFor, type VatFigure, type VatFigureGroup } from '@kompass/module-finance/vat-forms';

/**
 * Die Zeilen der Kennzahlen-Tabelle der Seite „Umsatzsteuer-Voranmeldung“ (Board 8a/8b, Plan E6b Task 8): nur Kennzahlen
 * mit Wert (in der berichtigten oder der abgegebenen Fassung); bei offener Berichtigung zuerst Kz 10 und je Zeile der
 * abgegebene Wert (aus dem Abbild der letzten Abgabe) neben dem berichtigten. Rein.
 */
export interface VatFigureRow {
  code: string;
  group: VatFigureGroup;
  label: string;
  unit: VatFigure['unit'];
  source: VatFigure['source'];
  /** Der Wert heute (Cent bzw. 1 bei Kz 10). */
  cents: number;
  /** Der abgegebene Wert; `null` ohne Abbild der Abgabe oder ohne Berichtigung. */
  filedCents: number | null;
  changed: boolean;
  entryIds: string[];
}

interface Input {
  formYear: number;
  taxation: 'regular' | 'smallBusiness';
  values: readonly { source: string; cents: number; entryIds: string[] }[];
  /** Nur bei offener Berichtigung: das Abbild der letzten Abgabe, `null` für eine Abgabe ohne Abbild (vor E6b). */
  filed?: Record<string, number> | null;
  amendment: boolean;
}

const shown = (figure: VatFigure, cents: number) => (figure.unit === 'euro' ? euroBase(cents) !== 0 : cents !== 0);

export function vatFigureRows(input: Input): VatFigureRow[] {
  const form = vatFormFor('advance', input.formYear);
  if (!form) return [];
  const byValue = new Map(input.values.map((v) => [v.source, v] as const));
  const filed = input.amendment ? (input.filed ?? null) : null;
  const rows: VatFigureRow[] = [];
  for (const figure of form.figures) {
    if (figure.taxation !== undefined && figure.taxation !== input.taxation) continue;
    if (figure.source === 'amended') {
      if (input.amendment) rows.push({ code: figure.code, group: figure.group, label: keepSectionSign(figure.label), unit: figure.unit, source: figure.source, cents: 1, filedCents: null, changed: true, entryIds: [] });
      continue;
    }
    const value = byValue.get(figure.source);
    const cents = value?.cents ?? 0;
    const filedCents = filed ? (filed[figure.source] ?? 0) : null;
    if (!shown(figure, cents) && !(filedCents !== null && shown(figure, filedCents))) continue;
    const comparable = (c: number) => (figure.unit === 'euro' ? euroBase(c) : c);
    rows.push({ code: figure.code, group: figure.group, label: keepSectionSign(figure.label), unit: figure.unit, source: figure.source, cents, filedCents, changed: filedCents !== null && comparable(filedCents) !== comparable(cents), entryIds: value?.entryIds ?? [] });
  }
  return rows;
}

/** Die Bemessungsgrundlage zu einer Steuerkennzahl (47 → 46, 85 → 84), für „19 % von Kz 46“. */
export const BASE_OF_TAX: Partial<Record<VatFigure['source'], VatFigure['source']>> = { rc13bEuTax: 'rc13bEuBase', rc13bOtherTax: 'rc13bOtherBase' };
