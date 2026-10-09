import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';

/** `text` ersetzt den Standardsatz, wo die Liste einen eigenen Hinweis braucht (Protokoll: Personen über „Nutzer“, Designer 2026-10-09). */
type Filtered = ({ noun: string; onReset: () => void } | { noun: string; resetHref: string }) & { text?: string };

/**
 * Leerzustand einer Liste in zwei Fällen (Board § L Ziel 3, HANDOFF § 8e.1): ganz leer — Titel, Text und eine
 * Aktion zum Anlegen vom Aufrufer — oder gefiltert leer: „{Nomen} passt zu diesen Filtern.“ mit „Filter
 * zurücksetzen“ als Aktion, nie „Noch keine …“ und nie Anlegen.
 */
export function EmptyState(props: { title: string; text: string; action?: ReactNode } | { filtered: Filtered }) {
  return 'filtered' in props ? <FilteredEmpty filtered={props.filtered} /> : <Frame {...props} />;
}

function FilteredEmpty({ filtered }: { filtered: Filtered }) {
  const t = useTranslations('common.emptyFiltered');
  const reset =
    'resetHref' in filtered ? (
      <Link href={filtered.resetHref} className={buttonVariants({ variant: 'outline' })}>
        {t('reset')}
      </Link>
    ) : (
      <Button type="button" variant="outline" onClick={filtered.onReset}>
        {t('reset')}
      </Button>
    );
  return <Frame title={t('title', { noun: filtered.noun })} text={filtered.text ?? t('text')} action={reset} />;
}

function Frame({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <section className="flex min-h-[240px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong bg-surface p-7 text-center">
      <h3 className="font-heading text-[17px]">{title}</h3>
      <p className="max-w-[480px] text-[14px] text-ink-2">{text}</p>
      {action ? <div className="mt-2 flex items-center gap-2">{action}</div> : null}
    </section>
  );
}
