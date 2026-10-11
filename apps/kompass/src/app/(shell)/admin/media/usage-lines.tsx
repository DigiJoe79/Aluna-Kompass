'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { MediaListingItem } from '@/lib/media-listing';

/**
 * Die Verwendungen eines Bilds, eine je Zeile (Handover alle Bilder 4, Board 3a). Zeigt eine Fundstelle einen
 * Ausschnitt, steht „· zugeschnitten“ gedämpft dahinter: Das erklärt, warum das Bild auf der Webseite anders aussieht.
 * Bearbeitet wird der Ausschnitt nur an der Verwendung — in der Liste führt die Zeile ins Detail, dort `linked` zur Stelle.
 */
export function UsageLines({ references, linked = false }: { references: MediaListingItem['references']; linked?: boolean }) {
  const t = useTranslations('media');
  if (references.length === 0) return <span className="text-ink-2">{t('unused')}</span>;
  return (
    <ul className="flex flex-col">
      {references.map((r, i) => (
        <li key={`${r.label}-${i}`}>
          {linked && r.href ? (
            <Link href={r.href} className="text-link underline">
              {r.label}
            </Link>
          ) : (
            r.label
          )}
          {r.cropped ? <span className="text-muted-ink"> {t('crop.trimmedLine')}</span> : null}
        </li>
      ))}
    </ul>
  );
}
