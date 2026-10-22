import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { SectionHeading } from '@/components/section';
import { Button, buttonVariants } from '@/components/ui/button';

/** `text` ersetzt den Standardsatz, wo die Liste einen eigenen Hinweis braucht (Protokoll: Personen über „Nutzer“, Designer 2026-10-09). */
type Filtered = ({ noun: string; onReset: () => void } | { noun: string; resetHref: string }) & { text?: string };

/**
 * Zustandskarte für 404, 403 und „Modul aus“ (Designer Stufe 2 Nr. 13): dieselbe Karte wie der Leerzustand — Marke,
 * Titel, Text, höchstens zwei Aktionen, die primäre rechts. Sie ersetzt den Seiteninhalt, ihr Titel ist deshalb das
 * `h1` der Seite (in der Rolle Seitentitel), und sie hat eine feste Breite (`task`), egal wie breit die Seite ist.
 */
type StateCard = { mark?: ReactNode; title: string; text: ReactNode; detail?: ReactNode; primary?: ReactNode; secondary?: ReactNode };

/**
 * Leerzustand einer Liste in zwei Fällen (Board § L Ziel 3, HANDOFF § 8e.1): ganz leer — Titel, Text und eine
 * Aktion zum Anlegen vom Aufrufer — oder gefiltert leer: „{Nomen} passt zu diesen Filtern.“ mit „Filter
 * zurücksetzen“ als Aktion, nie „Noch keine …“ und nie Anlegen.
 */
export function EmptyState(props: { title: string; text: string; action?: ReactNode } | { filtered: Filtered } | { state: StateCard }) {
  if ('state' in props) return <StateFrame {...props.state} />;
  return 'filtered' in props ? <FilteredEmpty filtered={props.filtered} /> : <Frame {...props} />;
}

function StateFrame({ mark, title, text, detail, primary, secondary }: StateCard) {
  return (
    <section className="flex w-full max-w-task flex-col items-center gap-2 rounded-lg border border-dashed border-line-strong bg-surface p-7 text-center">
      {mark}
      <h1 className="font-heading text-page-title">{title}</h1>
      <p className="max-w-[480px] text-body text-ink-2">{text}</p>
      {detail}
      {primary || secondary ? (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {secondary}
          {primary}
        </div>
      ) : null}
    </section>
  );
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
  return <Frame title={t('title', { noun: filtered.noun })} text={filtered.text ?? t('text')} action={reset} filtered />;
}

/** `data-slot`/`data-filtered` lassen Tests den Leerzustand am Baustein erkennen statt am Wortlaut. */
function Frame({ title, text, action, filtered = false }: { title: string; text: string; action?: ReactNode; filtered?: boolean }) {
  return (
    <section
      data-slot="empty-state"
      data-filtered={filtered || undefined}
      className="flex min-h-[240px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong bg-surface p-7 text-center"
    >
      <SectionHeading>{title}</SectionHeading>
      <p className="max-w-[480px] text-body text-ink-2">{text}</p>
      {action ? <div className="mt-2 flex items-center gap-2">{action}</div> : null}
    </section>
  );
}
