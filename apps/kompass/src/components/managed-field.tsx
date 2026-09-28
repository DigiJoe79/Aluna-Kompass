'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';

/**
 * Ein Feld, das ein eingeschaltetes Modul führt (`managedSettings`, E-1):
 * der Wert steht als Text auf `--surface-2` mit gestricheltem Rahmen, daneben
 * das Kennzeichen „geführt“, darunter „geführt unter …“ als Link zur Stelle,
 * die den Wert pflegt. Kein Eingabeelement — per Tab ist nur der Link
 * erreichbar, nie das Wertfeld.
 */
export function ManagedField({ label, value, managedBy }: { label: string; value: string; managedBy: { label: string; href: string } }) {
  const t = useTranslations('common.managedField');
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold text-ink-2">{label}</span>
        <span className="rounded-sm bg-badge px-1.5 py-0.5 text-[11px] font-semibold text-badge-ink">{t('badge')}</span>
      </div>
      <p data-testid="managed-field-value" className="flex h-[var(--field-h)] w-full items-center rounded-md border border-dashed border-line bg-surface-2 px-2.5 text-sm text-ink">
        {value.trim() === '' ? '—' : value}
      </p>
      <Link href={managedBy.href} className="w-fit text-[12px] font-semibold text-ink underline underline-offset-2">
        {t('linkText', { label: managedBy.label })}
      </Link>
    </div>
  );
}
