'use client';

import { ExternalLink, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { Notice } from '@/components/notice';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';

type Answer = { doc: string; title: string; href: string; leadHtml: string } | { doc: null; indexHtml: string };

/** Die Hilfe steht als Nebenspalte neben der Seite (ab `lg`). Seitenpanels klappen dann ein (Entwurf E4, „Eine Nebenspalte“). */
export const HelpAsideContext = createContext(false);
export const useHelpAside = () => useContext(HelpAsideContext);

/** Lädt die Hilfe zur Seite; folgt weichen Navigationen. `retry` lädt neu. */
function useHelp(open: boolean, pathname: string) {
  const [state, setState] = useState<{ pathname: string; answer: Answer | 'error' } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(`/api/help?path=${encodeURIComponent(pathname)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Answer>) : Promise.reject(new Error(String(r.status)))))
      .then((answer) => { if (!cancelled) setState({ pathname, answer }); })
      .catch(() => { if (!cancelled) setState({ pathname, answer: 'error' }); });
    return () => { cancelled = true; };
  }, [open, pathname, attempt]);
  const current = state?.pathname === pathname ? state.answer : null;
  return { current, retry: () => { setState(null); setAttempt((n) => n + 1); } };
}

/**
 * Die Hilfe zur aktuellen Seite (Entwurf E4, Designer 2026-10-17; MUSTER § I): der Kurzabsatz, der Weg ins Handbuch.
 *
 * - `mode="aside"` (ab `lg`): Nebenspalte, nicht modal — `aside` „Hilfe“ ohne Abdunkeln und Fokusfalle, der Inhalt
 *   rückt. Beim Öffnen geht der Fokus auf den Titel; Esc (in der Hilfe), × und der Knopf schließen. Beim
 *   Seitenwechsel bleibt sie offen und zeigt die Hilfe der neuen Seite; der Fokus bleibt auf der Seite.
 * - `mode="sheet"` (darunter): das modale Blatt wie bisher, Überlagerung ohne Unschärfe.
 */
export function HelpPanel({ mode, open, onClose, pathname }: { mode: 'aside' | 'sheet'; open: boolean; onClose: () => void; pathname: string }) {
  const t = useTranslations('shell.help');
  const { current, retry } = useHelp(open, pathname);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const title = current && current !== 'error' && current.doc ? t('titleFor', { title: current.title }) : t('label');
  const href = current && current !== 'error' && current.doc ? current.href : '/help';

  // Fokus auf den Titel nur beim Öffnen, nicht beim Seitenwechsel (Notiz „Seitenwechsel“).
  useEffect(() => {
    if (mode === 'aside' && open) titleRef.current?.focus();
  }, [mode, open]);

  const body = (
    <div className="prose-preview mt-4 text-body text-ink-2">
      {current === null ? (
        <div className="h-16 animate-pulse rounded-md bg-surface-2" aria-hidden />
      ) : current === 'error' ? (
        <Notice level="refuse" remedies={[{ label: t('retry'), onSelect: retry }]}>
          {t('failed')}
        </Notice>
      ) : current.doc !== null ? (
        <div dangerouslySetInnerHTML={{ __html: current.leadHtml }} />
      ) : (
        <>
          <EmptyState title={t('none')} text={t('noneText')} />
          <div onClick={mode === 'sheet' ? onClose : undefined} dangerouslySetInnerHTML={{ __html: current.indexHtml }} />
        </>
      )}
    </div>
  );
  const handbook = (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1 text-meta text-link underline underline-offset-2">
      {t('openHandbook')}
      <ExternalLink className="size-3.5" aria-hidden />
    </a>
  );

  if (mode === 'sheet') {
    return (
      <Sheet open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
        <SheetContent side="right" size="sm" className="gap-0 overflow-y-auto bg-surface shadow-md" data-testid="help-panel">
          <div className="flex flex-col gap-1 p-5">
            <SheetTitle>{title}</SheetTitle>
            {handbook}
            {body}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  if (!open) return null;
  return (
    <aside
      id="help-panel"
      aria-label={t('label')}
      data-testid="help-panel"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        onClose();
      }}
      className="flex w-[360px] shrink-0 flex-col border-l border-line bg-surface xl:w-[400px]"
    >
      <div className="flex items-start gap-2 border-b border-line px-5 pt-4 pb-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {/* Titel wie `SheetTitle` (19/600), hier ohne Dialog; fokussierbar, damit Vorleser ansagen, wo man ist. */}
          <h2 ref={titleRef} tabIndex={-1} className="font-heading text-dialog-title text-ink outline-none focus-visible:outline-2 focus-visible:outline-focus">
            {title}
          </h2>
          {handbook}
        </div>
        <button type="button" onClick={onClose} aria-label={t('close')} className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-ink hover:bg-row-hover hover:text-ink">
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">{body}</div>
    </aside>
  );
}
