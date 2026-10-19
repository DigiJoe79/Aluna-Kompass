import type { ResignationAnchor } from './settings';

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
/** Letzter Tag des Monats `m` (1–12). */
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** `day` plus `months` Monate; fällt der Tag im Zielmonat weg, gilt dessen letzter (30.11. + 3 → 28.02.). */
function addMonths(day: string, months: number): { y: number; m: number; d: number } {
  const [y0, m0, d0] = day.split('-').map(Number) as [number, number, number];
  const total = y0 * 12 + (m0 - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return { y, m, d: Math.min(d0, lastDay(y, m)) };
}

/**
 * Das vorgeschlagene Ende eines Austritts (Spec § 3.3): der früheste Tag ab Eingang der Kündigung plus Frist, der auf
 * den Stichtag fällt — Ende des Geschäftsjahres (hier das Kalenderjahr), des Quartals, des Monats, oder genau dieser
 * Tag. Rein; die Einstellung liest der Dienst.
 */
export function proposeResignationEnd(noticeOn: string, rule: { months: number; at: ResignationAnchor }): string {
  const { y, m, d } = addMonths(noticeOn, rule.months);
  switch (rule.at) {
    case 'any':
      return iso(y, m, d);
    case 'monthEnd':
      return iso(y, m, lastDay(y, m));
    case 'quarterEnd': {
      const qm = Math.ceil(m / 3) * 3;
      return iso(y, qm, lastDay(y, qm));
    }
    case 'fiscalYearEnd':
      return iso(y, 12, 31);
  }
}
