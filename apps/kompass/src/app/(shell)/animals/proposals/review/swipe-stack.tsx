'use client';

import type { PhotoCrop, ProposalKind } from '@kompass/module-animals';
import { ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { EmptyState } from '@/components/empty-state';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { Notice } from '@/components/notice';
import { PendingPublishNote } from '@/components/site/pending-publish';
import { useSiteJobStatus } from '@/components/site/site-job-provider';
import { Button } from '@/components/ui/button';
import type { ActionState } from '@/lib/actions';
import { toastNetwork, toastRefusal } from '@/lib/feedback';
import { flushHeldDecision, holdDecision } from '@/lib/held-decision';
import { cn } from '@/lib/utils';
import { CropFrame } from '../../crop-frame';
import { acceptProposalAction, rejectProposalAction } from '../actions';
import { KindBadge } from '../kind-badge';
import type { StackReason, StackRight } from './stack-route';

export interface StackCard {
  id: string;
  kind: ProposalKind;
  name: string;
  sourceName: string;
  createdAt: string;
  /** Titelbild: Adresse, Ausschnitt der Quelle und Seitenverhältnis Breite/Höhe des ganzen Fotos, soweit bekannt. */
  image: { url: string; crop: PhotoCrop | null; ratio: number | null } | null;
  /** Felder kurz: „Größe (cm): 52 → 55“; `from: null` bei neuem Hund. */
  lines: { label: string; from: string | null; to: string }[];
  photosLine: string | null;
  right: StackRight;
}

type Tally = { accepted: number; rejected: number; open: number };
const THRESHOLD = 96;
/** Ein Bild höchstens so hoch wie die halbe Fensterhöhe: hochkant (4:5) füllte es am Telefon sonst den Schirm. */
const fitHeight = (ratio: number | null) => (ratio ? `calc(50svh * ${ratio})` : undefined);

/**
 * Durchgehen im Wisch-Stapel (Spec § 6, Board 3b–3e, 8b): rechts annehmen (ein vollständiger neuer Hund geht online), links ablehnen
 * ohne Grund, hoch prüfen; am Rechner ← ↑ →. Die Entscheidung wird 5 s zurückgehalten (`holdDecision`, Ausnahme
 * MUSTER § C): Die Karte geht sofort und zählt sofort (sonst stünde am Ende 5 s lang „0 angenommen“, M3); „Rückgängig“
 * nimmt die Zählung zurück, eine Ablehnung des Dienstes verschiebt sie nach „offen gelassen“ und steht über dem Stapel.
 */
export function SwipeStack({ cards, backHref, query, frame }: { cards: StackCard[]; backHref: string; query: string; frame: { aspectRatio: string; objectPosition: string } }) {
  const t = useTranslations('animals.proposals.stack');
  const ph = useTranslations('animals.photos');
  const onlineNoteId = useId();
  const [frameW, frameH] = frame.aspectRatio.split('/').map(Number);
  const frameRatio = frameW && frameH ? frameW / frameH : null;
  const h = useTranslations('animals.proposals.held');
  const p = useTranslations('animals.proposals');
  const dates = useDateFormat();
  const router = useRouter();
  const { refresh } = useSiteJobStatus();
  const [queue, setQueue] = useState(cards);
  const [tally, setTally] = useState<Tally>({ accepted: 0, rejected: 0, open: 0 });
  const [refusal, setRefusal] = useState<{ name: string; state: ActionState } | null>(null);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  // Nach „Fertig“ oder „Prüfen“ ist der Stapel weg, bevor die Antwort kommt: Dann steht eine Ablehnung als Toast da.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // Fest vom Öffnen an: Nach jeder Entscheidung rendert der Server die Seite mit weniger Karten neu (revalidate).
  const [total] = useState(cards.length);
  const card = queue[0] ?? null;
  const reviewHref = (id: string) => `/animals/proposals/${id}${query ? `?${query}` : ''}`;

  const toReview = useCallback(
    (c: StackCard) => {
      flushHeldDecision();
      router.push(reviewHref(c.id));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router, query],
  );

  const decide = useCallback(
    (c: StackCard, side: 'accept' | 'reject') => {
      setRefusal(null);
      setQueue((q) => q.filter((x) => x.id !== c.id));
      const counted = side === 'reject' ? 'rejected' : 'accepted';
      setTally((n) => ({ ...n, [counted]: n[counted] + 1 }));
      const online = side === 'accept' && c.right.kind === 'accept' && c.right.publish;
      holdDecision({
        key: c.id,
        message: side === 'reject' ? h('rejected', { name: c.name }) : online ? h('acceptedOnline', { name: c.name }) : h('accepted', { name: c.name }),
        countdown: (seconds) => h('undo', { seconds }),
        send: () => (side === 'reject' ? rejectProposalAction(c.id, '', c.name) : acceptProposalAction(online ? { id: c.id, publish: true } : { id: c.id }, c.name)),
        networkMessage: t('network', { name: c.name }),
        onSent: (state) => {
          if (state.status === 'error') {
            toastNetwork(state, '');
            if (!mounted.current) {
              toastRefusal(state);
              return;
            }
            setRefusal({ name: c.name, state });
            setTally((n) => ({ ...n, [counted]: n[counted] - 1, open: n.open + 1 }));
            return;
          }
          refresh();
        },
        onUndo: () => {
          setQueue((q) => [c, ...q.filter((x) => x.id !== c.id)]);
          setTally((n) => ({ ...n, [counted]: n[counted] - 1 }));
        },
      });
    },
    [h, t, refresh],
  );

  const right = useCallback((c: StackCard) => (c.right.kind === 'review' ? toReview(c) : decide(c, 'accept')), [decide, toReview]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!card || e.defaultPrevented) return;
      const target = e.target;
      if ((target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')) || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      if (e.key === 'ArrowRight') right(card);
      else if (e.key === 'ArrowLeft') decide(card, 'reject');
      else if (e.key === 'ArrowUp') toReview(card);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, decide, right, toReview]);

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, a')) return;
    start.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (start.current) setDrag({ x: e.clientX - start.current.x, y: e.clientY - start.current.y });
  };
  const onUp = () => {
    const d = drag;
    start.current = null;
    setDrag(null);
    if (!d || !card) return;
    if (d.x > THRESHOLD) right(card);
    else if (d.x < -THRESHOLD) decide(card, 'reject');
    else if (d.y < -THRESHOLD) toReview(card);
  };
  const stamp = drag ? (drag.x > THRESHOLD / 2 ? (card?.right.kind === 'review' ? t('stampReview') : card?.right.kind === 'accept' && card.right.publish ? t('stampOnline') : t('stampAccept')) : drag.x < -THRESHOLD / 2 ? t('stampReject') : drag.y < -THRESHOLD / 2 ? t('stampReview') : null) : null;
  const reasonText = (reasons: StackReason[]) => {
    const missing = reasons.filter((r) => r === 'missingPrimaryPhoto' || r === 'missingSummary').map((r) => t(`reasons.${r}`));
    const other = reasons.filter((r) => r !== 'missingPrimaryPhoto' && r !== 'missingSummary').map((r) => t(`reasons.${r}`));
    return `${[...other, ...missing].join(' · ')}. ${t('reviewOnly')}`;
  };
  const tallyLine = t('tally', tally);
  if (total === 0) return <EmptyState title={t('emptyTitle')} text={t('emptyText')} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            flushHeldDecision();
            router.push(backHref);
          }}
        >
          {t('done')}
        </Button>
        <span className="text-meta text-ink-2" aria-live="polite">
          {card ? t('position', { index: total - queue.length + 1, total }) : null}
        </span>
      </div>
      {refusal ? <RefusalNotice action state={{ ...refusal.state, status: 'error', fieldErrors: {}, title: t('refusedTitle', { name: refusal.name }) } as ActionState} /> : null}
      {card ? (
        <>
          <div
            data-testid="stack-card"
            className="relative touch-pan-y select-none overflow-hidden rounded-lg border border-line bg-surface shadow-sm"
            style={drag ? { transform: `translate(${drag.x}px, ${Math.min(0, drag.y)}px) rotate(${drag.x / 30}deg)` } : undefined}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={() => { start.current = null; setDrag(null); }}
            onDragStart={(e) => e.preventDefault()}
          >
            {stamp ? <span className="absolute top-4 left-4 z-1 rounded-md border-2 border-brand bg-surface px-3 py-1 font-heading text-section text-brand" aria-hidden>{stamp}</span> : null}
            {/* Das Titelbild wie die Fotokacheln des Tiers (`photos-editor.tsx`): mit Ausschnitt der Quelle das ganze Foto
                mit Rahmen (`CropFrame`), sonst im Format und Fokus der Webseite (`animals.photoFrame`). Zu hoch wird es
                schmaler, nie anders beschnitten. */}
            <div className="bg-surface-2">
              <div className="mx-auto w-full" style={{ maxWidth: fitHeight(card.image?.crop ? card.image.ratio : frameRatio) }}>
                {card.image?.crop ? (
                  <CropFrame src={card.image.url} crop={card.image.crop} label={ph('crop')} className="rounded-none" />
                ) : card.image ? (
                  <img src={card.image.url} alt="" draggable={false} style={frame} className="block w-full object-cover" />
                ) : (
                  <span className="block w-full" style={{ aspectRatio: frame.aspectRatio }} aria-hidden />
                )}
              </div>
            </div>
            <div className="flex flex-col gap-2 p-4">
              <span className="w-fit">
                <KindBadge kind={card.kind} />
              </span>
              <h2 className="font-heading text-dialog-title text-ink">{card.name || p('unnamed')}</h2>
              <span className="text-meta text-ink-2">{card.sourceName} · {dates.dateTime(card.createdAt)}</span>
              {card.lines.length ? (
                <ul className="m-0 flex list-none flex-col gap-1 p-0 text-meta">
                  {card.lines.map((l) => (
                    <li key={l.label}>
                      <span className="font-semibold text-ink-2">{l.label}: </span>
                      {l.from !== null ? <><span className="text-ink-2">{l.from || '—'}</span> → </> : null}
                      <span className="text-ink">{l.to || '—'}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {card.photosLine ? <span className="text-meta text-ink-2">{card.photosLine}</span> : null}
              {card.right.kind === 'accept' && card.right.publish ? <p id={onlineNoteId} className="m-0 text-meta text-ink">{t('acceptOnline')}</p> : null}
              {card.right.kind === 'review' ? <Notice level="warn">{reasonText(card.right.reasons)}</Notice> : null}
            </div>
          </div>
          {/* Eine Zeile, drei gleich breite Spalten, auch am Telefon (Joe 2026-10-10, iPhone); die Pfeile zeigen die
              Wischrichtung. Kein Layout-Test — Einzelstelle, Laufzeit zählt. Der zugängliche Name beginnt mit dem
              sichtbaren Text (WCAG 2.5.3); „online“ steht als Zeile auf der Karte und ist die Beschreibung. */}
          <div className="grid grid-cols-3 gap-2">
            <Button type="button" variant="outline" onClick={() => decide(card, 'reject')}>
              <ArrowLeft aria-hidden data-icon="inline-start" />
              {t('reject')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => toReview(card)}>
              <ArrowUp aria-hidden data-icon="inline-start" />
              {t('review')}
            </Button>
            <Button
              type="button"
              onClick={() => right(card)}
              aria-label={card.right.kind === 'review' ? t('toReview') : undefined}
              aria-describedby={card.right.kind === 'accept' && card.right.publish ? onlineNoteId : undefined}
            >
              {card.right.kind === 'review' ? t('review') : t('accept')}
              <ArrowRight aria-hidden data-icon="inline-end" />
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-3">
          <EmptyState title={t('endTitle')} text={tallyLine} />
          <PendingPublishNote />
        </div>
      )}
      <p className={cn('text-hint text-muted-ink max-sm:hidden', !card && 'hidden')}>{t('keys')}</p>
    </div>
  );
}
