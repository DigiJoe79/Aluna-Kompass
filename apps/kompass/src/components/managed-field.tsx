'use client';

import { FixedValue } from '@/components/fixed-value';
import type { FieldSize } from '@/components/forms/form-field';

/**
 * Ein Feld, das ein eingeschaltetes Modul führt (`managedSettings`, E-1): ein `FixedValue` (Entwurf E2). Wo der Wert
 * gepflegt wird, sagt einmal der Satz über den Feldern mit Link (Runde 3, 150/151: nicht „Geführt in …“ an jedem
 * Feld); `describedBy` verweist darauf, damit ein Vorleser ihn je Feld hört. Kein Eingabeelement.
 */
export function ManagedField({
  id,
  label,
  value,
  describedBy,
  mono,
  size,
}: {
  id: string;
  label: string;
  value: string;
  /** Kennung des Satzes „Wird unter … geführt.“ über den Feldern. */
  describedBy: string;
  mono?: boolean;
  size?: FieldSize;
}) {
  return <FixedValue id={id} label={label} value={value} mono={mono} size={size} testId="managed-field" describedBy={describedBy} />;
}
