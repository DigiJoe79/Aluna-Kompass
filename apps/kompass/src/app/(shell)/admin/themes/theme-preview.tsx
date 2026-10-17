'use client';

import type { Theme } from '@kompass/core/themes';
import { THEME_TOKENS } from '@kompass/core/themes';
import { useTranslations } from 'next-intl';
import type { CSSProperties } from 'react';
import { Input } from '@/components/ui/input';
import { Overline } from '@/components/overline';
import { formatEuro } from '@/lib/finance/amount';
import { StatusBadge } from '@/components/status-badge';

export function ThemePreview({ theme, mode }: { theme: Theme; mode: 'light' | 'dark' }) {
  const t = useTranslations('themes.preview');
  const style = Object.fromEntries(
    THEME_TOKENS.map((token) => [`--${token}`, theme.tokens[token][mode]])
  ) as CSSProperties;
  return (
    <div style={style} data-testid="theme-preview" className="flex flex-col gap-3 rounded-md border border-line bg-bg p-3 text-ink">
      <div className="rounded-md border border-line bg-sidebar p-2">
        <Overline as="div" className="mb-1 px-2">
          {t('group')}
        </Overline>
        <div className="rounded-md bg-brand-soft px-2 py-1.5 text-meta font-semibold text-brand-ink shadow-[inset_2px_0_0_var(--color-primary)]">
          {t('activeItem')}
        </div>
        <div className="px-2 py-1.5 text-meta text-ink-2">{t('item')}</div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="preview-primary-button"
          className="rounded-md bg-brand px-3 py-1.5 text-meta font-semibold text-on-brand"
        >
          {t('primary')}
        </button>
        <button
          type="button"
          className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-meta font-semibold text-ink-2"
        >
          {t('secondary')}
        </button>
        <button
          type="button"
          className="rounded-md border border-error px-3 py-1.5 text-meta font-semibold text-error"
        >
          {t('destructive')}
        </button>
        {/* Gesperrter Primärknopf wie `ui/button`: hell die Fläche gedämpft, dunkel ohne Deckkraft `disabled-bg`, Schrift
            `disabled-ink`, Rand `line-strong` (Punkt 7; Runde 3, 179; Runde 4 Nachtrag, 215). */}
        <button
          type="button"
          disabled
          data-testid="preview-locked-button"
          className={`rounded-md border px-3 py-1.5 text-meta font-semibold ${mode === 'dark' ? 'border-line-strong bg-disabled text-disabled-ink' : 'border-transparent bg-brand text-on-brand opacity-50'}`}
        >
          {t('locked')}
        </button>
      </div>
      {/* Die echten Marken in den Farben des Themes, alle Töne außer `brand` (Runde 3, 179). */}
      <div className="flex flex-wrap gap-1.5">
        <StatusBadge tone="success" dot>{t('badgeActive')}</StatusBadge>
        <StatusBadge tone="warning" dot>{t('badgeOpen')}</StatusBadge>
        <StatusBadge tone="error" dot>{t('badgeError')}</StatusBadge>
        <StatusBadge tone="info" dot>{t('badgeInfo')}</StatusBadge>
        <StatusBadge tone="agent" dot>{t('badgeAgent')}</StatusBadge>
        <StatusBadge tone="final" dot>{t('badgeFinal')}</StatusBadge>
        <StatusBadge tone="neutral" dot>{t('badgeInactive')}</StatusBadge>
      </div>
      <Input readOnly value={t('inputValue')} />
      <table className="w-full overflow-hidden rounded-md border border-line text-hint">
        <thead className="bg-table-head text-muted-ink">
          <tr>
            <th className="px-2 py-1 text-left">{t('col1')}</th>
            <th className="px-2 py-1 text-left">{t('col2')}</th>
          </tr>
        </thead>
        <tbody>
          <tr className="bg-surface">
            <td className="px-2 py-1">{t('row')} 1</td>
            <td className="tabular-nums px-2 py-1">{formatEuro(123400)}</td>
          </tr>
          <tr className="bg-zebra">
            <td className="px-2 py-1">{t('row')} 2</td>
            <td className="tabular-nums px-2 py-1">{formatEuro(5600)}</td>
          </tr>
          <tr className="bg-row-hover">
            <td className="px-2 py-1">{t('row')} 3</td>
            <td className="tabular-nums px-2 py-1">{formatEuro(700)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
