'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';

type Answer = { doc: string; title: string; href: string; leadHtml: string } | { doc: null; indexHtml: string };

/**
 * Die Hilfe zur aktuellen Seite: nur der Kurzabsatz, dann der Weg ins
 * Handbuch. Lädt beim Öffnen, damit die Schale nichts vom Handbuch wissen
 * muss und die Hilfe weichen Navigationen folgt.
 */
export function HelpPanel({ open, onOpenChange, pathname }: { open: boolean; onOpenChange: (open: boolean) => void; pathname: string }) {
  const t = useTranslations();
  const [state, setState] = useState<{ pathname: string; answer: Answer | 'error' } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(`/api/help?path=${encodeURIComponent(pathname)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Answer>) : Promise.reject(new Error(String(r.status)))))
      .then((answer) => { if (!cancelled) setState({ pathname, answer }); })
      .catch(() => { if (!cancelled) setState({ pathname, answer: 'error' }); });
    return () => { cancelled = true; };
  }, [open, pathname]);

  const current = state?.pathname === pathname ? state.answer : null;
  const title = current && current !== 'error' && current.doc ? current.title : t('help.title');

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[400px] gap-0 overflow-y-auto bg-surface p-6 shadow-md" data-testid="help-panel">
        <SheetTitle className="font-heading text-[19px]">{title}</SheetTitle>
        <div className="prose-preview mt-3 text-[14px]">
          {current === null ? (
            <div className="h-16 animate-pulse rounded-md bg-surface-2" aria-hidden />
          ) : current === 'error' ? (
            <p className="text-muted-ink">{t('shell.help.unavailable')}</p>
          ) : current.doc !== null ? (
            <>
              <div dangerouslySetInnerHTML={{ __html: current.leadHtml }} />
              <Link href={current.href} onClick={() => onOpenChange(false)} className="mt-2 inline-block font-semibold text-link underline">
                {t('shell.help.readAll')}
              </Link>
            </>
          ) : (
            <>
              <p className="text-muted-ink">{t('shell.help.none')}</p>
              <div onClick={() => onOpenChange(false)} dangerouslySetInnerHTML={{ __html: current.indexHtml }} />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
