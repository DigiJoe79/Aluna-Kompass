'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Disclosure } from '@/components/ui/disclosure';

export interface Findings {
  gaps: { collection: string; id: string; field: string }[];
  violations: { path: string; term: string; excerpt: string }[];
}

const linkFor = (collection: string, id: string) =>
  collection === 'pages' ? `/website/pages/${id}` : collection === 'animals' ? '/animals' : `/website/${collection}`;

/**
 * Die Befunde eines Exports. Prüfen und Vorschau zeigen dieselben zwei Listen,
 * deshalb stehen sie hier einmal.
 *
 * Sperrworttreffer bleiben aufgeklappt — sie verhindern den Publish. Alles
 * andere fängt zugeklappt an; Übersetzungslücken betreffen heute jede Seite
 * des englischen Baums und schoben die Karten darunter aus dem Bild.
 */
export function ExportFindings({ gaps, violations }: Findings) {
  const t = useTranslations('website.publish.check');

  return (
    <>
      <Disclosure
        label={t('violationsTitle')}
        count={violations.length}
        tone={violations.length > 0 ? 'error' : 'neutral'}
        alarm={violations.length > 0}
        defaultOpen={violations.length > 0}
        empty={t('noViolations')}
      >
        <ul className="flex flex-col gap-1">
          {violations.map((v, i) => (
            <li key={i}>
              <span className="font-mono">{v.path}</span> · <span className="font-semibold text-error">{v.term}</span> ·{' '}
              <span className="text-ink-2">{v.excerpt}</span>
            </li>
          ))}
        </ul>
      </Disclosure>
      <Disclosure label={t('gapsTitle')} count={gaps.length} empty={t('noGaps')}>
        <ul className="flex flex-col gap-1">
          {gaps.map((g, i) => (
            <li key={i}>
              <Link href={linkFor(g.collection, g.id)} className="text-link underline">
                {g.collection} · {g.id}
              </Link>{' '}
              · <span className="font-mono">{g.field}</span>
            </li>
          ))}
        </ul>
      </Disclosure>
    </>
  );
}
