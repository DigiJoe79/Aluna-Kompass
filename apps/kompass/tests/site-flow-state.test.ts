import type { SiteJobRunView } from '@kompass/module-site';
import { describe, expect, it } from 'vitest';
import { deriveFlowState, hintCount, type FlowInput } from '@/app/(shell)/site/publish/flow-state';
import type { DetailView } from '@/lib/site-job-view';

const zero = { changed: 0, added: 0, removed: 0, violations: 0, gaps: 0, stale: 0, pendingReview: 0, skippedImages: 0 };
const job = (over: Partial<DetailView>): DetailView =>
  ({ kind: 'preview', runId: 'R', startedAt: 't0', finishedAt: 't1', userId: 'U', userName: 'Erika', status: 'success', counts: { ...zero, changed: 1 }, contentHash: 'a', log: { text: '', truncated: false }, ...over }) as DetailView;
const preview = (over: Partial<DetailView> = {}) => job({ kind: 'preview', runId: 'PV', ...over });
const publish = (over: Partial<DetailView> = {}) => job({ kind: 'publish', runId: 'PU', ...over });
const run = (over: Partial<SiteJobRunView> = {}) => ({ runId: 'X', kind: 'preview', source: 'ui', userId: 'U', startedAt: 't', steps: [], cancellable: true, elapsedMs: 0, userName: null, ...over }) as SiteJobRunView;
const base: FlowInput = { running: null, preview: null, publish: null, currentHash: null, lastPublishedAt: null, endedHere: null };

describe('deriveFlowState', () => {
  it('shows a running job of any kind, deploy checks included', () => expect(deriveFlowState({ ...base, running: run({ kind: 'deployCheck' }) }).kind).toBe('running'));
  it('is none without any job', () => expect(deriveFlowState(base)).toEqual({ kind: 'none', lastPublishedAt: null }));
  it('marks a preview outdated when the current hash differs, even if it had a blocked term', () => {
    expect(deriveFlowState({ ...base, preview: preview({ contentHash: 'a', counts: { ...zero, violations: 1 } }), currentHash: 'b' }).kind).toBe('outdated');
  });
  it.each([[{ violations: 1 }, 'blocked'], [{}, 'unchanged'], [{ changed: 2 }, 'ready']])('%o → %s', (c, kind) => {
    expect(deriveFlowState({ ...base, preview: preview({ contentHash: 'a', counts: { ...zero, ...c } }), currentHash: 'a' }).kind).toBe(kind);
  });
  it('trusts the preview as it is while the current hash is unknown', () => {
    expect(deriveFlowState({ ...base, preview: preview({ counts: { ...zero, changed: 2 } }), currentHash: null }).kind).toBe('ready');
  });
  it('shows a successful publish only in the tab that saw it end', () => {
    const p = publish({ runId: 'P', status: 'success', finishedAt: 't2' });
    expect(deriveFlowState({ ...base, preview: preview({ finishedAt: 't1', superseded: true }), publish: p, endedHere: 'P' }).kind).toBe('ended');
    expect(deriveFlowState({ ...base, preview: preview({ finishedAt: 't1', superseded: true }), publish: p, lastPublishedAt: 't2' })).toEqual({ kind: 'none', lastPublishedAt: 't2' });
  });
  it('keeps an interrupted preview after reload', () => {
    expect(deriveFlowState({ ...base, preview: preview({ status: 'interrupted' }) })).toMatchObject({ kind: 'ended', retry: 'preview' });
  });
  it('treats a preview that a publish overtook as none', () => {
    expect(deriveFlowState({ ...base, preview: preview({ superseded: true }) }).kind).toBe('none');
  });
  it('offers the same preview again after a failed publish only while it is current', () => {
    const pv = preview({ contentHash: 'a', finishedAt: 't1', counts: { ...zero, changed: 1 } });
    const failed = publish({ status: 'failed', finishedAt: 't2', error: { code: 'publishFailed', message: '' } });
    expect(deriveFlowState({ ...base, preview: pv, publish: failed, currentHash: 'a' })).toMatchObject({ kind: 'ended', retry: 'publish' });
    expect(deriveFlowState({ ...base, preview: pv, publish: failed, currentHash: 'b' })).toMatchObject({ kind: 'ended', retry: 'preview' });
    expect(deriveFlowState({ ...base, preview: pv, publish: { ...failed, error: { code: 'previewOutdated', message: '' } }, currentHash: 'a' })).toMatchObject({ retry: 'preview' });
  });
});

describe('hintCount', () => {
  it('sums the hints that do not stop a publish', () => {
    expect(hintCount({ counts: { ...zero, gaps: 2, stale: 1, pendingReview: 3, skippedImages: 1, violations: 5, changed: 9 } })).toBe(7);
  });
});
