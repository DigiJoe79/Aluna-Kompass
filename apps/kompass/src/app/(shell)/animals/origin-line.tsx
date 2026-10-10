'use client';

import { useTranslations } from 'next-intl';
import { Fragment } from 'react';

/** „Herkunft: {Quelle} · Seite ansehen“ in der Statuskarte am Hund (Board Vorschläge 7a); mehrere Quellen mit „ · “. */
export function OriginLine({ origins }: { origins: readonly { sourceName: string; externalUrl: string | null }[] }) {
  const t = useTranslations('animals.origin');
  if (origins.length === 0) return null;
  return (
    <p data-testid="animal-origin" className="text-meta text-ink-2">
      {t('label')}{' '}
      {origins.map((o, i) => (
        <Fragment key={`${o.sourceName}-${i}`}>
          {i > 0 ? ' · ' : null}
          {o.sourceName}
          {o.externalUrl ? (
            <>
              {' · '}
              <a href={o.externalUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-link">
                {t('viewPage')}
              </a>
            </>
          ) : null}
        </Fragment>
      ))}
    </p>
  );
}
