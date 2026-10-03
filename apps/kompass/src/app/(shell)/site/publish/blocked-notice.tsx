import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import type { DetailView } from '@/lib/site-job-view';

type Violation = NonNullable<DetailView['violations']>[number];

/** Wohin ein Treffer führt: Variablen auf ihre Seite, Sammlungseinträge in ihre Maske, Zeilen einer Sicht auf ihre Bearbeiten-Seite; Dateinamen nirgends. */
export const editHref = (edit: Violation['edit']): string | null =>
  !edit ? null : edit.kind === 'variables' ? '/site/variables' : edit.kind === 'view' ? edit.href : `/site/c/${edit.collection}/${edit.id}`;

const VISIBLE = 3;

/** Der Ausschnitt, mit dem Begriff an der ersten Fundstelle markiert (Groß-/Kleinschreibung und Trenner egal). */
function Excerpt({ text, term }: { text: string; term: string }): ReactNode {
  const parts = term.trim().split(/[\s_-]+/).filter(Boolean).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const match = parts.length > 0 ? new RegExp(parts.join('[\\s_-]+'), 'i').exec(text) : null;
  if (!match) return text;
  return (
    <>
      {text.slice(0, match.index)}
      <mark className="bg-transparent font-semibold underline decoration-error decoration-2">{match[0]}</mark>
      {text.slice(match.index + match[0].length)}
    </>
  );
}

function Hit({ v }: { v: Violation }) {
  const t = useTranslations('site.publish.flow.blocked');
  const href = editHref(v.edit);
  return (
    <li className="flex flex-col gap-1">
      <p className="text-[13px]">
        <strong className="font-bold text-error">{v.term}</strong> · <span className="font-mono text-[12px]">{v.path}</span>
      </p>
      <p className="text-[13px] text-ink-2">
        <Excerpt text={v.excerpt} term={v.term} />
      </p>
      {href && v.edit ? (
        <Link href={href} className="w-fit text-[13px] font-medium text-link underline">
          {v.edit.kind === 'variables' ? t('editVariables') : t('edit', { title: v.edit.title })}
        </Link>
      ) : null}
    </li>
  );
}

/**
 * Warum der Publish gesperrt ist: höchstens drei Treffer mit Begriff, Pfad,
 * markiertem Ausschnitt und Weg zum Inhalt, der Rest zugeklappt. Mit dem Recht
 * „Webseite pflegen“ führt ein Link zur Liste der gesperrten Begriffe.
 */
export function BlockedNotice({ violations, canManage }: { violations: NonNullable<DetailView['violations']>; canManage: boolean }) {
  const t = useTranslations('site.publish.flow.blocked');
  const shown = violations.slice(0, VISIBLE);
  const rest = violations.slice(VISIBLE);
  return (
    <section aria-label={t('title')} className="flex flex-col gap-3 rounded-md border border-error bg-error-bg p-4">
      <ul className="flex flex-col gap-3">
        {shown.map((v, i) => (
          <Hit key={i} v={v} />
        ))}
      </ul>
      {rest.length > 0 ? (
        <details className="text-[13px]">
          <summary className="cursor-pointer font-medium">{t('more', { count: rest.length })}</summary>
          <ul className="mt-3 flex flex-col gap-3">
            {rest.map((v, i) => (
              <Hit key={i} v={v} />
            ))}
          </ul>
        </details>
      ) : null}
      <p className="text-[13px] text-ink-2">
        {canManage
          ? t.rich('manage', {
              link: (chunks) => (
                <Link href="/admin/site?panel=blockedTerms" className="font-medium text-link underline">
                  {chunks}
                </Link>
              ),
            })
          : t('noManage')}
      </p>
    </section>
  );
}
