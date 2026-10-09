'use client';

import type { PublishSummary } from '@kompass/module-site';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useSiteJobStatus } from '@/components/site/site-job-provider';
import { Skeleton } from '@/components/ui/skeleton';
import { startPreviewAction, startPublishAction } from './actions';
import { PublishConfirmDialog } from './confirm-dialog';
import { deriveFlowState } from './flow-state';
import { PublishFlowCard } from './flow-card';
import { PublishHistory } from './history';
import { LogDialog, subjectOfJob, type LogSubject } from './log-dialog';
import { useSiteJobDetail, useStartJob } from './last-result';
import { publishFollowUp } from './publish-follow-up';

export function PublishClient({
  env,
  publicUrl,
  hasDeploy,
  canManage,
  imageCacheEmpty,
  history,
  historyTotal,
  currentHash,
  lastPublishedAt,
}: {
  env: string;
  publicUrl: string | null;
  hasDeploy: boolean;
  canManage: boolean;
  imageCacheEmpty: boolean;
  history: PublishSummary[];
  /** Alle Publishes der Umgebung — `history` sind nur die jüngsten. */
  historyTotal: number;
  /** Inhalts-Hash des Stands beim Laden der Seite; frisch nach jedem Lauf, weil der Poller die Seite dann erneuert. */
  currentHash: string | null;
  lastPublishedAt: string | null;
}) {
  const router = useRouter();
  const { enabled, running, last } = useSiteJobStatus();
  // Das letzte Ergebnis jeder Art kommt vom Server (auch nach dem Neuladen, auch wenn ein Assistent gebaut hat).
  const preview = useSiteJobDetail('preview');
  const publish = useSiteJobDetail('publish');
  const { pending, start, state: startRefusal } = useStartJob();

  // Ein gelungener Publish steht nur in dem Tab als „Publiziert“, der ihn laufen oder starten sah.
  const watched = useRef<string | null>(null);
  const startedHere = useRef<string | null>(null);
  const [endedHere, setEndedHere] = useState<string | null>(null);
  useEffect(() => {
    if (running?.runId === watched.current) return;
    if (watched.current) setEndedHere(watched.current);
    watched.current = running?.runId ?? null;
  }, [running?.runId]);
  const ended = endedHere ?? (publish && publish.runId === startedHere.current ? publish.runId : null);

  const state = deriveFlowState({ running, preview, publish, currentHash, lastPublishedAt, endedHere: ended });

  // Nach einem Start wandert der Fokus auf den Titel der Karte, damit Tastatur und Vorlesen den neuen Zustand finden.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [focusWish, setFocusWish] = useState(false);
  useEffect(() => {
    if (!focusWish) return;
    headingRef.current?.focus();
    setFocusWish(false);
  }, [focusWish, state.kind]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [logSubject, setLogSubject] = useState<LogSubject | null>(null);
  const started = (runId: string) => {
    startedHere.current = runId;
    setFocusWish(true);
  };
  const startPreview = () => start(startPreviewAction, { onStarted: started });
  const startPublish = (expectedContentHash: string) =>
    start(() => startPublishAction({ expectedContentHash }), {
      onStarted: started,
      onError: (state) => {
        // Der Server hat die Vorschau abgelehnt: Die Seite lädt neu und zeigt „nicht mehr aktuell“.
        if (publishFollowUp(state.code)) router.refresh();
      },
    });

  const dialogPreview =
    state.kind === 'ready' || state.kind === 'unchanged' ? state.preview : state.kind === 'ended' && state.retry === 'publish' ? preview : null;
  // Bevor der Poller ein Ergebnis gebracht und der Server sein Detail geliefert hat, steht ein Platzhalter statt „Noch keine Vorschau“.
  const loading = enabled && (last === null || (!!last.preview && !preview) || (!!last.publish && !publish));

  return (
    <>
      <RefusalNotice action state={startRefusal} />
      {loading && !running ? (
        <div aria-busy="true" className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-10 w-48" />
        </div>
      ) : (
        <PublishFlowCard
          state={state}
          env={env}
          publicUrl={publicUrl}
          hasDeploy={hasDeploy}
          canManage={canManage}
          imageCacheEmpty={imageCacheEmpty}
          busy={pending}
          headingRef={headingRef}
          onRequestPublish={() => setDialogOpen(true)}
          onRetryPublish={() => setDialogOpen(true)}
          onOpenLog={(job) => setLogSubject(subjectOfJob(job))}
          onStartPreview={startPreview}
        />
      )}
      {dialogPreview ? (
        <PublishConfirmDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          env={env}
          publicUrl={publicUrl}
          preview={dialogPreview}
          onPublish={startPublish}
          onRebuild={startPreview}
        />
      ) : null}
      <LogDialog item={logSubject} onClose={() => setLogSubject(null)} />
      <PublishHistory items={history} total={historyTotal} highlightId={state.kind === 'ended' && state.job.status === 'success' ? (state.job.publishId ?? null) : null} />
    </>
  );
}
