import { describe, expect, it } from 'vitest';
import { nextPollDelay, POLL_IDLE_MS, POLL_RUNNING_MS, transitions } from '@/lib/site-job-poll';
import type { OverviewView, SummaryView } from '@/lib/site-job-view';

const run = (runId: string) => ({ runId, kind: 'preview' as const, source: 'ui' as const, userId: 'U', startedAt: 't', steps: [], cancellable: true, elapsedMs: 0, userName: null, tokenName: null });
const summary = (runId: string, status: SummaryView['status'] = 'success'): SummaryView => ({
  kind: 'preview',
  runId,
  startedAt: 't',
  finishedAt: 't',
  userId: 'U',
  userName: null,
  status,
  counts: { changed: 0, added: 0, removed: 0, violations: 0, gaps: 0, stale: 0, pendingReview: 0, skippedImages: 0 },
});
const view = (running: ReturnType<typeof run> | null, preview: SummaryView | null = null): OverviewView => ({ running, last: { preview, publish: null, deployCheck: null } });

describe('nextPollDelay', () => {
  it('polls fast while something runs and slowly otherwise', () => {
    expect(nextPollDelay(view(run('R1')))).toBe(POLL_RUNNING_MS);
    expect(nextPollDelay(view(null))).toBe(POLL_IDLE_MS);
    expect(nextPollDelay(null)).toBe(POLL_IDLE_MS);
    expect(POLL_RUNNING_MS).toBe(2_000);
    expect(POLL_IDLE_MS).toBe(30_000);
  });
});

describe('transitions', () => {
  it('sees a start and an end of a run this tab saw running', () => {
    const idle = view(null, summary('R0'));
    const running = view(run('R1'), summary('R0'));
    const done = view(null, summary('R1'));
    expect(transitions(idle, running, new Set(['R1']))).toMatchObject({ started: true, finished: [] });
    const end = transitions(running, done, new Set(['R1']));
    expect(end.started).toBe(false);
    expect(end.finished).toEqual([{ kind: 'preview', summary: summary('R1') }]);
  });

  it('announces nothing for a run this tab never saw', () => {
    expect(transitions(view(null, summary('R0')), view(null, summary('R1')), new Set()).finished).toEqual([]);
    expect(transitions(null, view(null, summary('R1')), new Set()).finished).toEqual([]);
  });

  it('does not count a vanished run as finished while its result is missing, but does once it shows as interrupted (S3)', () => {
    const seen = new Set(['R2']);
    const running = view(run('R2'), summary('R1'));
    const vanished = view(null, summary('R1'));
    expect(transitions(running, vanished, seen).finished).toEqual([]);
    const interrupted = view(null, summary('R2', 'interrupted'));
    expect(transitions(vanished, interrupted, seen).finished).toEqual([{ kind: 'preview', summary: summary('R2', 'interrupted') }]);
  });

  it('announces a result only once', () => {
    const done = view(null, summary('R1'));
    expect(transitions(done, done, new Set(['R1'])).finished).toEqual([]);
  });
});
