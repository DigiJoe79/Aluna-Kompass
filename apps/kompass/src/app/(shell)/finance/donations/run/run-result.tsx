'use client';

import { runItemKindKey } from '@/lib/finance/run-item-kind';
import type { RunView, RunViewItem } from '@kompass/module-finance';
import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useDateFormat } from '@/components/date-format-provider';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { ActionState } from '@/lib/actions';
import { formatEuro } from '@/lib/finance/amount';
import { runProgress } from '@/lib/finance/run';
import { dispatchRunConfirmationsAction } from './actions';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';

type SentVia = 'post' | 'email' | 'handed';

/**
 * Das Ergebnis des Serienlaufs (README 3i): zwei Sammel-PDFs getrennt
 * (maschinell / zum Unterschreiben), Versandvermerk für alle (ein Vermerk,
 * kein Versand), die Abarbeitungszeile „Unterschriebene Fassung fehlt“ zur
 * Liste der Bestätigungen, nicht ausgestellte und übersprungene Spender mit
 * Grund und der Nachzügler-Lauf mit dem Satz, wer noch fehlt.
 */
export function RunResult({ run, canIssue, today, missing, followUpHref }: { run: RunView; canIssue: boolean; today: string; missing: { count: number; names: string[] }; followUpHref: string }) {
  const t = useTranslations('finance.donations.run');
  const tv = useTranslations('finance.donations.sentVia');
  const { date } = useDateFormat();
  const [dispatching, setDispatching] = useState(false);
  const [downloading, setDownloading] = useState<'machine' | 'signature' | null>(null);
  const [refusal, setRefusal] = useState<ActionState>({ status: 'idle' });
  const tCommon = useTranslations('common');
  const { total } = runProgress(run.counts);

  const errorText = (code: string | null) => {
    const key = `errorCode.${code ?? 'unknown'}`;
    return code && t.has(key) ? t(key) : t('errorCode.unknown', { code: code ?? '—' });
  };

  const download = async (part: 'machine' | 'signature') => {
    setDownloading(part);
    setRefusal({ status: 'idle' });
    try {
      const response = await fetch(`/finance/donations/run/${run.id}/bundle?part=${part}`);
      if (!response.ok) {
        const body = response.status === 409 ? ((await response.json()) as { message?: string }) : null;
        setRefusal({ status: 'error', message: body?.message ?? t('result.bundleFailed'), fieldErrors: {} });
        return;
      }
      const disposition = response.headers.get('content-disposition') ?? '';
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `serienlauf-${run.year}-${part}.pdf`;
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      // Der Server war nicht zu erreichen: keine Ablehnung, sondern ein Toast zum Wiederholen.
      toast.error(tCommon('network'), { duration: Infinity, closeButton: true, action: { label: tCommon('retry'), onClick: () => void download(part) } });
    } finally {
      setDownloading(null);
    }
  };

  const failed = run.items.filter((i) => i.state === 'failed');
  const skipped = run.items.filter((i) => i.state === 'skipped');

  return (
    <section data-testid="run-result" className="space-y-4 rounded-md border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
        <span>{t('result.startedOn', { year: run.year, date: date(run.startedOn) })}</span>
        {run.followUpOfRunId ? <StatusBadge tone="neutral">{t('result.followUpOf')}</StatusBadge> : null}
      </div>
      <p data-testid="run-summary" className="font-heading text-[19px] text-ink">
        {t('result.summary', { issued: run.counts.issued, total })}
      </p>

      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-ink">{t('result.bundles')}</p>
        <RefusalNotice action state={refusal} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={run.counts.machine === 0 || downloading !== null} onClick={() => void download('machine')}>
            <Download aria-hidden />
            {t('result.bundleMachine', { count: run.counts.machine })}
          </Button>
          <Button type="button" variant="outline" disabled={run.counts.needsSignature === 0 || downloading !== null} onClick={() => void download('signature')}>
            <Download aria-hidden />
            {t('result.bundleSignature', { count: run.counts.needsSignature })}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[13px]">
        {run.dispatchedAt && run.dispatchedVia ? (
          <p data-testid="run-dispatched" className="text-ink">{t('result.dispatched', { date: date(run.dispatchedAt), via: tv(run.dispatchedVia) })}</p>
        ) : canIssue && run.counts.machine > 0 ? (
          <Button type="button" onClick={() => setDispatching(true)}>{t('result.dispatchAll')}</Button>
        ) : null}
        {run.counts.missingSignedVersion > 0 ? (
          <Link href="/finance/donations?tab=needsSignature" className="text-link underline">
            {t('result.missingSigned', { count: run.counts.missingSignedVersion })}
          </Link>
        ) : null}
      </div>

      {failed.length > 0 ? <ItemList testId="run-failed" title={t('result.failed')} items={failed} reason={(i) => errorText(i.errorCode)} /> : null}
      {skipped.length > 0 ? <ItemList testId="run-skipped" title={t('result.skipped')} items={skipped} reason={(i) => errorText(i.errorCode)} /> : null}

      <div data-testid="run-missing" className="flex flex-wrap items-center justify-between gap-3 border-t border-line-2 pt-3 text-[13px]">
        {missing.count > 0 ? (
          <>
            <p className="text-ink">{t('result.missing', { count: missing.count, names: missing.names.join(', ') })}</p>
            <Link href={followUpHref} className="rounded-sm border border-line bg-surface px-3 py-1.5 font-semibold text-ink hover:bg-surface-2">
              {t('result.followUpAction')}
            </Link>
          </>
        ) : (
          <p className="text-ink-2">{t('result.missingNone')}</p>
        )}
      </div>

      {dispatching ? <DispatchAllDialog runId={run.id} today={today} onClose={() => setDispatching(false)} /> : null}
    </section>
  );
}

function ItemList({ testId, title, items, reason }: { testId: string; title: string; items: RunViewItem[]; reason: (item: RunViewItem) => string }) {
  const t = useTranslations('finance.donations.run');
  return (
    <div data-testid={testId} className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-ink">{title} · {items.length}</p>
      <ul className="divide-y divide-line-2 rounded-md border border-line text-[13px]">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-1.5">
            <span className="flex flex-wrap items-baseline gap-x-3">
              <span className="font-semibold text-ink">{item.contactName}</span>
              <span className="text-ink-2">{t(`itemKind.${runItemKindKey(item.kind, item.lineCount)}`)}</span>
              <span className="text-ink-2">{reason(item)}</span>
            </span>
            <span className="font-mono tabular-nums text-ink">{formatEuro(item.totalCents)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Versand für alle vermerken (Annahme 8): Datum und Weg, einmal für alle maschinellen Bestätigungen des Laufs. */
function DispatchAllDialog({ runId, today, onClose }: { runId: string; today: string; onClose: () => void }) {
  const td = useTranslations('finance.donations.run.dispatch');
  const tv = useTranslations('finance.donations.sentVia');
  const router = useRouter();
  const [sentAt, setSentAt] = useState(today);
  const [sentVia, setSentVia] = useState<SentVia>('post');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  const submit = async () => {
    setPending(true);
    const result = await feedback.run(() => dispatchRunConfirmationsAction({ runId, sentAt, sentVia }), { retry: () => void submit() });
    setPending(false);
    if (result.status === 'success') {
      onClose();
      router.refresh();
    }
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="sm" layout="fixed-footer" className="bg-surface shadow-md">
        <DialogHeader>
          <DialogTitle className="font-heading text-[19px]">{td('title')}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <p className="text-[13px] text-ink-2">{td('text')}</p>
          <FormGrid>
            <FormField id="run-dispatch-date" label={td('sentAt')} required size="s">
              <Input id="run-dispatch-date" type="date" value={sentAt} max={today} onChange={(e) => setSentAt(e.target.value)} />
            </FormField>
            <FormField id="run-dispatch-via" label={td('sentVia')} required size="s">
              <Select id="run-dispatch-via" value={sentVia} onChange={(e) => setSentVia(e.target.value as SentVia)}>
                {(['post', 'email', 'handed'] as const).map((via) => (
                  <option key={via} value={via}>{tv(via)}</option>
                ))}
              </Select>
            </FormField>
          </FormGrid>
        </DialogBody>
        <FormActionBar placement="dialog" cancel={onClose} pending={pending} saveDisabled={!sentAt} saveLabel={td('submit')} onSave={() => void submit()} state={feedback.state} />
      </DialogContent>
    </Dialog>
  );
}
