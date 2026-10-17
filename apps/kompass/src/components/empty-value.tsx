import { EMPTY } from '@kompass/core/format';
import { useTranslations } from 'next-intl';

export { EMPTY } from '@kompass/core/format';

/**
 * Leerwert im JSX (MUSTER § Leerwert, Freigabe Stufe-1-Auftrag, Joe 2026-10-11): „—“ grau, für Vorleser
 * „keine Angabe“. Ohne `'use client'`, damit er in Server- und Client-Bausteinen gleich steht; in `option`,
 * `title` und anderen Attributen geht kein Element — dort `EMPTY`.
 */
export function Empty() {
  const t = useTranslations('common');
  return (
    <span role="img" aria-label={t('empty')} data-empty className="text-muted-ink">
      {EMPTY}
    </span>
  );
}
