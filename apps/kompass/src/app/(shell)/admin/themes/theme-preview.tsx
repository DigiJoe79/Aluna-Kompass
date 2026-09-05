'use client';

import type { Theme } from '@kompass/core/themes';
import { THEME_TOKENS } from '@kompass/core/themes';
import { useTranslations } from 'next-intl';
import type { CSSProperties } from 'react';

export function ThemePreview({ theme, mode }: { theme: Theme; mode: 'light' | 'dark' }) {
  const t = useTranslations('themes.preview');
  const style = Object.fromEntries(
    THEME_TOKENS.map((token) => [`--${token}`, theme.tokens[token][mode]])
  ) as CSSProperties;
  return (
    <div style={style} className="flex flex-col gap-3 rounded-md border border-line bg-bg p-3 text-ink">
      <div className="rounded-md border border-line bg-sidebar p-2">
        <div className="px-2 pb-1 text-[11px] font-bold uppercase tracking-[.09em] text-muted-ink">
          {t('group')}
        </div>
        <div className="rounded-md bg-brand-soft px-2 py-1.5 text-[13px] font-semibold text-brand-ink shadow-[inset_2px_0_0_var(--color-primary)]">
          {t('activeItem')}
        </div>
        <div className="px-2 py-1.5 text-[13px] text-ink-2">{t('item')}</div>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          data-testid="preview-primary-button"
          className="rounded-md bg-brand px-3 py-1.5 text-[13px] font-semibold text-on-brand"
        >
          {t('primary')}
        </button>
        <button
          type="button"
          className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-[13px] font-semibold text-ink-2"
        >
          {t('secondary')}
        </button>
        <button
          type="button"
          className="rounded-md border border-error px-3 py-1.5 text-[13px] font-semibold text-error"
        >
          {t('destructive')}
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5 text-[12px] font-semibold">
        <span className="rounded-sm bg-success-bg px-2 py-0.5 text-success">{t('badgeActive')}</span>
        <span className="rounded-sm bg-warning-bg px-2 py-0.5 text-warning">{t('badgeOpen')}</span>
        <span className="rounded-sm bg-error-bg px-2 py-0.5 text-error">{t('badgeError')}</span>
        <span className="rounded-sm bg-badge px-2 py-0.5 text-badge-ink">{t('badgeInactive')}</span>
      </div>
      <input
        readOnly
        value={t('inputValue')}
        className="h-8 rounded-md border border-line-strong bg-field px-2 text-[13px] text-ink"
      />
      <table className="w-full overflow-hidden rounded-md border border-line text-[12px]">
        <thead className="bg-table-head text-muted-ink">
          <tr>
            <th className="px-2 py-1 text-left">{t('col1')}</th>
            <th className="px-2 py-1 text-left">{t('col2')}</th>
          </tr>
        </thead>
        <tbody>
          <tr className="bg-surface">
            <td className="px-2 py-1">{t('row')} 1</td>
            <td className="px-2 py-1 font-mono">1.234,00 €</td>
          </tr>
          <tr className="bg-zebra">
            <td className="px-2 py-1">{t('row')} 2</td>
            <td className="px-2 py-1 font-mono">56,00 €</td>
          </tr>
          <tr className="bg-row-hover">
            <td className="px-2 py-1">{t('row')} 3</td>
            <td className="px-2 py-1 font-mono">7,00 €</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
