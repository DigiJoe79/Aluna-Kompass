'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { FixedValue } from '@/components/fixed-value';
import type { FieldSize } from '@/components/forms/form-field';

/**
 * Ein Feld, das ein eingeschaltetes Modul führt (`managedSettings`, E-1): ein `FixedValue` (Entwurf E2) mit dem
 * Grund „Geführt in …“ als Link zur Stelle, die den Wert pflegt. Das Wort „geführt“ steht nicht mehr im Wert.
 * Kein Eingabeelement — per Tab ist nur der Link erreichbar.
 */
export function ManagedField({
  id,
  label,
  value,
  managedBy,
  mono,
  size,
}: {
  id: string;
  label: string;
  value: string;
  managedBy: { label: string; href: string };
  mono?: boolean;
  size?: FieldSize;
}) {
  const t = useTranslations('common.managedField');
  return (
    <FixedValue
      id={id}
      label={label}
      value={value}
      mono={mono}
      size={size}
      testId="managed-field"
      reason={t.rich('reason', {
        link: (chunks) => (
          <Link href={managedBy.href} className="text-link underline underline-offset-2">
            {chunks}
          </Link>
        ),
        label: managedBy.label,
      })}
    />
  );
}
