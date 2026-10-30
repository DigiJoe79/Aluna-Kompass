import type { Majority } from '@kompass/module-governance/live';

type T = (key: string, values?: Record<string, string | number>) => string;

/**
 * Eine Mehrheit in Worten („mindestens drei Viertel der abgegebenen Stimmen“, „einfache Mehrheit der abgegebenen
 * Stimmen“), `t` im Namensraum `governance.majority` (Plan U1 Task 7).
 */
export function majorityText(t: T, m: Majority): string {
  const base = t(`base.${m.base}`);
  let text: string;
  if (m.fraction === 'simple') text = t('simple', { base });
  else {
    const key = `n${m.fraction.num}d${m.fraction.den}`;
    const named = ['n1d2', 'n2d3', 'n3d4', 'n9d10'].includes(key);
    const fraction = named ? t(`fractions.${key}`) : t('fractions.other', { num: m.fraction.num, den: m.fraction.den });
    text = t('fraction', { comparison: t(`comparison.${m.comparison ?? 'atLeast'}`), fraction, base });
  }
  return m.abstentions === 'asNo' ? t('asNo', { text }) : text;
}

/** Die Fundstelle einer Regel: eingetragen („§ 12 Abs. 3 Satzung“), sonst „laut Satzung“ bzw. „laut Gesetz: § 32 BGB“. */
export function ruleSource(t: T, rule: { source: 'statute' | 'law'; norm?: string; reference?: string }): string {
  if (rule.source === 'statute') return rule.reference ?? t('sourceStatute');
  return t('sourceLaw', { norm: rule.norm ?? '' });
}
