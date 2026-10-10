'use client';

import type { ProposalReview } from '@kompass/module-animals';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Notice } from '@/components/notice';
import { useSiteJobStatus } from '@/components/site/site-job-provider';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import type { ActionState } from '@/lib/actions';
import { toastRefusal } from '@/lib/feedback';
import { holdDecision } from '@/lib/held-decision';
import { setAnimalPublishedAction } from '../../actions';
import { mediaPreviewUrl } from '../../crop-frame';
import { StatusDialog } from '../../status-dialog';
import { acceptProposalAction, rejectProposalAction, resolveDelistedAction } from '../actions';
import { RejectDialog } from '../reject-dialog';
import { statusTone } from './review-values';
import { useDecisionDone } from './use-decision';

/**
 * Hinweis einer Quelle (Spec § 6, Board 5a): ihr Text groß, darunter der Hund mit Status und Veröffentlichung. Bei
 * „nicht mehr gelistet“ die Hauptaktion „Vermittelt · offline · erledigt“ — 5 s zurückgehalten wie im Stapel
 * (Ausnahme MUSTER § C); die Einzelschritte daneben für „verstorben“ oder andere Gründe.
 */
export function NoticeReview({ review, nextHref }: { review: ProposalReview; nextHref: string }) {
  const t = useTranslations('animals.proposals.notice');
  const s = useTranslations('animals.proposals');
  const f = useTranslations('animals.form');
  const c = useTranslations('content');
  const router = useRouter();
  const { refresh } = useSiteJobStatus();
  const done = useDecisionDone(nextHref);
  const { proposal } = review;
  const animal = review.animal!;
  const [rejecting, setRejecting] = useState(false);
  const [stepTaken, setStepTaken] = useState(false);
  const [refusal, setRefusal] = useState<ActionState | null>(null);
  const unpublish = useActionFeedback();
  const acknowledge = useActionFeedback();
  const mounted = useRef(true);
  const longId = useId();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const statusStep = animal.status !== 'adopted';
  const offlineStep = animal.isPublished;
  const delisted = proposal.noticeKind === 'delisted' && (statusStep || offlineStep);
  // Schritte, die schon erledigt sind, fallen aus der Hauptaktion und aus ihrer Beschriftung (Board 5a).
  const [short, long] = statusStep && offlineStep ? [t('resolveBoth'), t('resolveBothLong')] : offlineStep ? [t('resolveOffline'), t('resolveOfflineLong')] : [t('resolveStatus'), t('resolveStatusLong')];

  const resolve = () => {
    holdDecision({
      key: proposal.id,
      message: t('resolvedToast', { name: animal.name }),
      countdown: (seconds) => s('held.undo', { seconds }),
      send: () => resolveDelistedAction(proposal.id, animal.updatedAt),
      // Die Seite ist meist schon weiter: Dann steht eine Ablehnung als Toast da, nichts verschwindet still (MUSTER § A).
      onSent: (state) => {
        if (state.status === 'success') refresh();
        else if (mounted.current) setRefusal(state);
        else toastRefusal(state);
      },
    });
    router.push(nextHref);
  };

  return (
    <div className="flex flex-col gap-4">
      <RefusalNotice state={refusal ?? { status: 'idle' }} />
      {/* Hebt sich durch Stellung ab, nicht durch Größe: oben, mit begrenzter Zeilenlänge (Designer 2026-10-10). */}
      <p className="max-w-prose text-body text-ink" data-testid="notice-reason">{proposal.reason}</p>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-4" data-testid="notice-animal">
        {animal.photos[0] ? <img src={mediaPreviewUrl((animal.photos.find((p) => p.isPrimary) ?? animal.photos[0]).assetId)} alt="" className="size-10 shrink-0 rounded-full object-cover" /> : <span className="size-10 shrink-0 rounded-full bg-surface-2" aria-hidden />}
        <Link href={`/animals/${animal.id}`} className="font-semibold text-ink underline-offset-2 hover:underline">{animal.name}</Link>
        <StatusBadge tone={statusTone(animal.status)} dot>{f(`status.${animal.status}`)}</StatusBadge>
        <span className={animal.isPublished ? 'text-meta text-success' : 'text-meta text-muted-ink'}>{animal.isPublished ? c('published') : c('unpublished')}</span>
        {proposal.externalUrl ? (
          <a href={proposal.externalUrl} target="_blank" rel="noreferrer" className="ml-auto text-meta underline underline-offset-2 hover:text-link">{t('atSource', { source: proposal.sourceName })}</a>
        ) : null}
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-meta font-semibold text-ink-2">{t('steps')}</span>
        <RefusalNotice action state={unpublish.state} />
        <span className="flex flex-wrap items-center gap-2">
          {/* Einzelschritte sind gleichrangig: beide `outline` (Bildvergleich 2026-10-10, keine Layout-Tests für Einzelstellen). */}
          <StatusDialog animalId={animal.id} current={animal.status} triggerVariant="outline" />
          {animal.isPublished ? (
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                const result = await unpublish.run(() => setAnimalPublishedAction(animal.id, false));
                if (result.status === 'success') {
                  setStepTaken(true);
                  refresh();
                  router.refresh();
                }
              }}
            >
              {t('unpublish')}
            </Button>
          ) : null}
        </span>
        {stepTaken || (proposal.noticeKind === 'delisted' && !delisted) ? (
          <Notice level="hint">{t('stepTaken', { name: animal.name, status: f(`status.${animal.status}`) })}</Notice>
        ) : null}
      </div>
      <RefusalNotice action state={acknowledge.state} />
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <Button type="button" variant="ghost" onClick={() => setRejecting(true)}>{s('reject.open')}</Button>
        <span className="ml-auto flex flex-wrap gap-2">
          <Button type="button" variant={delisted ? 'secondary' : 'default'} onClick={async () => done(await acknowledge.run(() => acceptProposalAction({ id: proposal.id }, animal.name).then((r) => (r.status === 'success' ? { ...r, message: t('acknowledgedToast', { name: animal.name }) } : r))))}>
            {delisted ? t('acknowledgeOnly') : t('acknowledge')}
          </Button>
          {delisted ? (
            // Der sichtbare Text bleibt der Name (WCAG 2.5.3, Label in Name); die lange Fassung beschreibt nur.
            <>
              <Button type="button" onClick={resolve} aria-describedby={longId} title={long}>
                {short}
              </Button>
              <span id={longId} className="sr-only">{long}</span>
            </>
          ) : null}
        </span>
      </div>
      <RejectDialog open={rejecting} onOpenChange={setRejecting} sourceName={proposal.sourceName} onReject={async (reason) => done(await rejectProposalAction(proposal.id, reason, animal.name))} />
    </div>
  );
}
