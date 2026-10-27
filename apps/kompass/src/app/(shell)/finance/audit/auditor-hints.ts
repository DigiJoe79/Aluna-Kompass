import type { AuditorAccess } from '@kompass/module-finance';

/**
 * Hinweise an einem Prüfer (Board 12a/12b): Zugang und Unabhängigkeit, ohne Farbe; nur ein fehlender Zugang ist eine
 * Warnung, weil der Prüfer dann nicht arbeiten kann. Gemeinsam für den Abschnitt „Prüfer“ und den Dialog.
 */
export type AccessGap = 'noUser' | 'inactive' | 'noRole' | null;

/** Was einem Prüfer „in Kompass“ zum Arbeiten fehlt — `null`, wenn der Zugang steht oder bewusst beendet ist. */
export function accessGap(access: AuditorAccess): AccessGap {
  if (access.endedAt && !access.hasRole) return null;
  if (!access.userId) return 'noUser';
  if (!access.userActive) return 'inactive';
  if (!access.hasRole) return 'noRole';
  return null;
}
