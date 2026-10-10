'use client';

import type { ProposalKind } from '@kompass/module-animals';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { runAction } from '@/lib/feedback';
import { buildProposalPreviewAction } from '../actions';
import { usePreviewChoice } from './preview-choice';

const DEBOUNCE_MS = 600;
type Side = 'current' | 'choice';

/**
 * Vorschau der Detailseite (Board Vorschläge 7b): Seitenfenster `md` mit „Heute“ / „Mit Wahl“ (neuer Hund: nur „Mit
 * Wahl“). Gebaut wird beim Öffnen und, entprellt, bei jeder Änderung der Wahl; die Prüfseite bleibt bedienbar.
 */
export function PreviewSheet({ proposalId, name, kind }: { proposalId: string; name: string; kind: ProposalKind }) {
  const t = useTranslations('animals.proposals.preview');
  const choice = usePreviewChoice(proposalId);
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<Side>('choice');
  const [state, setState] = useState<{ url: string | null; loading: boolean; error: string | null }>({ url: null, loading: false, error: null });
  const network = t('network');

  useEffect(() => {
    if (!open) return;
    let current = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    const timer = setTimeout(async () => {
      const result = await runAction(() => buildProposalPreviewAction(proposalId, side, choice), network);
      if (!current) return;
      if (result.status === 'success') setState({ url: (result.data as { url: string }).url, loading: false, error: null });
      else setState({ url: null, loading: false, error: result.status === 'error' ? result.message : null });
    }, DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [open, side, choice, proposalId, network]);

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>{t('open')}</Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent size="md">
          <SheetHeader>
            <SheetTitle>{t('title', { name })}</SheetTitle>
            <SheetDescription>{t('description')}</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-3 p-5">
            {kind === 'create' ? null : (
              <Segmented<Side>
                aria-label={t('side')}
                value={side}
                onValueChange={setSide}
                options={[
                  { value: 'current', label: t('current') },
                  { value: 'choice', label: t('choice') },
                ]}
              />
            )}
            {state.error ? <Notice level="refuse">{state.error}</Notice> : null}
            {state.loading ? <p className="text-meta text-ink-2" aria-live="polite">{t('building')}</p> : null}
            {state.url && !state.error ? (
              <iframe key={state.url} src={state.url} title={t('frame', { name })} sandbox="allow-same-origin" className={`h-[70vh] w-full rounded-md border border-line ${state.loading ? 'opacity-60' : ''}`} />
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
