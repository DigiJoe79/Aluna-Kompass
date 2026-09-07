'use client';

import { useTranslations } from 'next-intl';
import { Disclosure } from '@/components/ui/disclosure';

export interface Findings {
  gaps: { path: string; locale: string }[];
  violations: { path: string; term: string; excerpt: string }[];
}

/**
 * Die Befunde eines Exports. Prüfen und Vorschau zeigen dieselben zwei Listen,
 * deshalb stehen sie hier einmal.
 *
 * Sperrworttreffer bleiben aufgeklappt — sie verhindern den Publish. Alles
 * andere fängt zugeklappt an.
 */
export function ExportFindings({ gaps, violations }: Findings) {
  const t = useTranslations('site.publish.check');

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
              <span className="font-mono">{g.path}</span>
              {g.locale ? (
                <>
                  {' '}· <span className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[11px] uppercase">{g.locale}</span>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </Disclosure>
    </>
  );
}
