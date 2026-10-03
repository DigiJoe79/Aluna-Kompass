import type { SiteJobRunView } from '@kompass/module-site';
import type { DetailView } from '@/lib/site-job-view';
import { publishFollowUp } from './publish-follow-up';

/** Der eine Zustand, den die Karte der Publizieren-Seite zeigt. */
export type FlowState =
  | { kind: 'none'; lastPublishedAt: string | null }
  | { kind: 'outdated'; preview: DetailView }
  | { kind: 'running'; run: SiteJobRunView }
  | { kind: 'ready' | 'unchanged' | 'blocked'; preview: DetailView }
  | { kind: 'ended'; job: DetailView; retry: 'publish' | 'preview' | null };

export interface FlowInput {
  running: SiteJobRunView | null;
  preview: DetailView | null;
  publish: DetailView | null;
  /** Inhalts-Hash des aktuellen Stands (ohne Kopie der Bilder berechnet); null, wenn er sich nicht berechnen ließ. */
  currentHash: string | null;
  /** Beginn des letzten erfolgreichen Publish dieser Umgebung. */
  lastPublishedAt: string | null;
  /** Die Kennung des Laufs, den dieser Tab zuletzt enden sah. */
  endedHere: string | null;
}

/** Die Hinweise der Vorschau, die den Publish nicht aufhalten: Lücken, veraltete Verweise, offene Prüfungen, unlesbare Bilder. */
export const hintCount = (d: Pick<DetailView, 'counts'>): number => d.counts.gaps + d.counts.stale + d.counts.pendingReview + d.counts.skippedImages;

const finishedAfter = (a: DetailView, b: DetailView) => a.finishedAt > b.finishedAt;

/**
 * Aus dem Stand der Abfrage den einen Zustand der Karte. Rein: Was die Seite
 * zeigt, hängt nur von diesen Eingaben ab.
 *
 * Ein gelungener Publish steht nur in dem Tab als „Publiziert“, der ihn enden
 * sah. Nach dem Neuladen gibt es dann wieder „keine Vorschau“ — er ist
 * verbraucht. Ein Neustart („unterbrochen“) dagegen bleibt stehen, denn
 * genau dann lädt man neu.
 */
export function deriveFlowState(i: FlowInput): FlowState {
  if (i.running) return { kind: 'running', run: i.running };
  const { preview, publish } = i;
  const newest = preview && publish ? (finishedAfter(publish, preview) ? publish : preview) : (publish ?? preview);
  if (!newest) return { kind: 'none', lastPublishedAt: i.lastPublishedAt };

  if (newest === publish && publish) {
    if (publish.status === 'success') {
      return publish.runId === i.endedHere ? { kind: 'ended', job: publish, retry: null } : { kind: 'none', lastPublishedAt: i.lastPublishedAt };
    }
    const again =
      preview !== null &&
      preview.status === 'success' &&
      !preview.superseded &&
      i.currentHash !== null &&
      preview.contentHash === i.currentHash &&
      publishFollowUp(publish.error?.code) === null;
    return { kind: 'ended', job: publish, retry: again ? 'publish' : 'preview' };
  }

  const pv = newest;
  if (pv.status !== 'success') return { kind: 'ended', job: pv, retry: 'preview' };
  if (pv.superseded) return { kind: 'none', lastPublishedAt: i.lastPublishedAt };
  if (i.currentHash !== null && pv.contentHash !== i.currentHash) return { kind: 'outdated', preview: pv };
  if (pv.counts.violations > 0) return { kind: 'blocked', preview: pv };
  if (pv.counts.changed + pv.counts.added + pv.counts.removed === 0) return { kind: 'unchanged', preview: pv };
  return { kind: 'ready', preview: pv };
}
