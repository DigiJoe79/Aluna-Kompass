'use client';

import { useTranslations } from 'next-intl';
import { useId, useState, type ReactNode } from 'react';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { StatusBadge, statusTone } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Disclosure } from '@/components/ui/disclosure';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ActionState } from '@/lib/actions';
import { cn } from '@/lib/utils';

export interface RemarkThreadItem {
  id: string;
  /** „Frage“ oder „Feststellung“ — die Art, fertig beschriftet. */
  kindLabel: string;
  state: 'open' | 'answered' | 'resolved';
  stateLabel: string;
  text: string;
  /** „Person · Datum“, bei Papier-Prüfern „<Prüferin>, eingetragen von <Prüfer> · Datum“. */
  byline: string;
  /** Woran der Vermerk hängt, wenn das nicht aus der Stelle folgt („An: Beleg BEL-12“). */
  target?: ReactNode;
  posts: { id: string; byline: string; text: string }[];
}

type Mode = 'answer' | 'followUp';

/**
 * Vermerke an einem Gegenstand (N3, Spec Rechenschaft § Bausteine, Freigabe Joe 2026-10-24; Board 4c, 9b): je Vermerk
 * Art und Zustand, Text, Person und Datum, darunter eingerückt die Antworten und Nachfragen. Handlungen als `outline`:
 * „Antworten“ (wer antworten darf), „Nachfragen“ und „Als geklärt markieren“ (Prüfer). Antworten und Nachfragen
 * stehen **inline** unter dem Vermerk, auf allen Breiten (9b). Geklärte stehen gedämpft und zugeklappt. Kein Finanzwort
 * im Baustein: Beschriftungen und Aktionen kommen vom Aufrufer.
 */
export function RemarkThread({
  remarks,
  canAnswer,
  canAudit,
  onAnswer,
  onFollowUp,
  onResolve,
}: {
  remarks: readonly RemarkThreadItem[];
  canAnswer: boolean;
  canAudit: boolean;
  onAnswer: (id: string, text: string) => Promise<ActionState>;
  onFollowUp: (id: string, text: string) => Promise<ActionState>;
  onResolve: (id: string) => Promise<ActionState>;
}) {
  const t = useTranslations('common.remarkThread');
  const active = remarks.filter((r) => r.state !== 'resolved');
  const resolved = remarks.filter((r) => r.state === 'resolved');
  const block = (r: RemarkThreadItem) => <RemarkBlock key={r.id} remark={r} canAnswer={canAnswer && r.state !== 'resolved'} canAudit={canAudit && r.state !== 'resolved'} onAnswer={onAnswer} onFollowUp={onFollowUp} onResolve={onResolve} />;
  return (
    <div className="flex flex-col gap-3">
      {active.map(block)}
      {resolved.length > 0 ? (
        <Disclosure label={t('resolvedCount', { count: resolved.length })} bounded={false}>
          <div className="flex flex-col gap-3">{resolved.map(block)}</div>
        </Disclosure>
      ) : null}
    </div>
  );
}

function RemarkBlock({
  remark,
  canAnswer,
  canAudit,
  onAnswer,
  onFollowUp,
  onResolve,
}: {
  remark: RemarkThreadItem;
  canAnswer: boolean;
  canAudit: boolean;
  onAnswer: (id: string, text: string) => Promise<ActionState>;
  onFollowUp: (id: string, text: string) => Promise<ActionState>;
  onResolve: (id: string) => Promise<ActionState>;
}) {
  const t = useTranslations('common.remarkThread');
  const c = useTranslations('common');
  const id = useId();
  const feedback = useActionFeedback();
  const [mode, setMode] = useState<Mode | null>(null);
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const quiet = remark.state === 'resolved';

  const send = async () => {
    if (!mode) return;
    setPending(true);
    const result = await feedback.run(() => (mode === 'answer' ? onAnswer(remark.id, text) : onFollowUp(remark.id, text)), { retry: () => void send() });
    setPending(false);
    if (result.status === 'success') {
      setMode(null);
      setText('');
    }
  };
  const resolve = async () => {
    setPending(true);
    await feedback.run(() => onResolve(remark.id), { retry: () => void resolve() });
    setPending(false);
  };

  return (
    <article className={cn('flex flex-col gap-2 rounded-md border border-line p-4', quiet && 'text-muted-ink')} data-testid={`remark-${remark.id}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold">{remark.kindLabel}</span>
        {remark.state === 'resolved' ? null : (
          <StatusBadge tone={statusTone('remark', remark.state)} dot>
            {remark.stateLabel}
          </StatusBadge>
        )}
        <span className="text-meta text-muted-ink">{remark.byline}</span>
      </div>
      {remark.target ? <p className="text-meta text-muted-ink">{remark.target}</p> : null}
      <p className="whitespace-pre-line text-body">{remark.text}</p>
      {remark.posts.length > 0 ? (
        <ul aria-label={t('postsLabel')} className="flex flex-col gap-2 border-l-2 border-line pl-4">
          {remark.posts.map((p) => (
            <li key={p.id} className="flex flex-col gap-0.5">
              <span className="text-meta text-muted-ink">{p.byline}</span>
              <span className="whitespace-pre-line text-body">{p.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <RefusalNotice action state={feedback.state} />
      {mode ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-text`}>{mode === 'answer' ? t('answerLabel') : t('followUpLabel')}</Label>
          <Textarea id={`${id}-text`} value={text} onChange={(e) => setText(e.target.value)} rows={3} autoFocus />
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={pending} onClick={() => void send()}>
              {mode === 'answer' ? t('answer') : t('followUp')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode(null)}>
              {c('cancel')}
            </Button>
          </div>
        </div>
      ) : canAnswer || canAudit ? (
        <div className="flex flex-wrap gap-2">
          {canAnswer ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setMode('answer')}>
              {t('answer')}
            </Button>
          ) : null}
          {canAudit ? (
            <>
              <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => void resolve()}>
                {t('resolve')}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setMode('followUp')}>
                {t('followUp')}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
