'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Notice } from '@/components/notice';
import { cn } from '@/lib/utils';
import { useSiteJobStatus } from './site-job-provider';

/**
 * Board Vorschläge 8b: der Satz am Ende des Stapels und der Prüfreihe (Plan B). Liest dieselbe Zahl wie die
 * Kopfzeile; ohne Provider (Webseite aus, Recht fehlt) und bei 0 nichts. Wer gerade entschieden hat, ruft vorher
 * `useSiteJobStatus().refresh()`, damit die Zahl die eigene Entscheidung schon enthält.
 */
export function PendingPublishNote() {
  const t = useTranslations('site.pending');
  const { pending } = useSiteJobStatus();
  if (!pending || pending.count === 0) return null;
  return (
    <Notice level="warn" testId="site-pending-note" action={<Link href="/site/publish" className="font-semibold text-link underline">{t('toPublish')}</Link>}>
      {t('note', { count: pending.count })}
    </Notice>
  );
}

/**
 * Board Vorschläge 8c: die Zeile am Datensatz, nur wenn er in der Liste steht. Überall gleich lautend und mit demselben
 * Weg zum Publizieren wie Kopfzeile und Hinweis (Designer 2026-10-10); am Hund unter „veröffentlicht“ in der
 * Statuskarte, an Masken ohne Statuskarte direkt unter dem Seitenkopf. `className` nur für Layout der Aufrufstelle.
 * Ohne Provider (Webseite aus, Recht `site.publish` fehlt) nichts.
 */
export function PendingPublishLine({ href, className }: { href: string; className?: string }) {
  const t = useTranslations('site.pending');
  const { pending } = useSiteJobStatus();
  if (!pending?.hrefs.includes(href)) return null;
  return (
    <span data-testid="site-pending-line" className={cn('text-hint text-warning', className)}>
      {t('line')}
      <span>
        {' · '}
        <Link href="/site/publish" className="underline underline-offset-2 hover:text-link">{t('toPublish')}</Link>
      </span>
    </span>
  );
}

/** Ab so vielen Variablen steht nur noch die Zahl (Designer 2026-10-10). */
const NAMED_VARIABLES = 3;

/**
 * Die Zeile der Variablen-Seite: Alle Variablen teilen sich diese eine Seite, deshalb eine Zeile, die sagt, was
 * geändert ist — bis drei mit Namen, ab vier nur die Zahl; keine Marke am einzelnen Feld. Sonst wie `PendingPublishLine`.
 */
export function PendingVariablesLine({ className }: { className?: string }) {
  const t = useTranslations('site.pending');
  const { pending } = useSiteJobStatus();
  const names = pending?.variables ?? [];
  if (names.length === 0) return null;
  return (
    <span data-testid="site-pending-line" className={cn('text-hint text-warning', className)}>
      {names.length <= NAMED_VARIABLES ? t('variablesNamed', { count: names.length, names: names.join(', ') }) : t('variables', { count: names.length })}
      <span>
        {' · '}
        <Link href="/site/publish" className="underline underline-offset-2 hover:text-link">{t('toPublish')}</Link>
      </span>
    </span>
  );
}

