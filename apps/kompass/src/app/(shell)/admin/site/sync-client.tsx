'use client';

import { losesContent, type Finding } from '@kompass/module-site/client';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { applySyncAction, previewSyncAction, type SyncPreviewState } from '@/app/(shell)/site/actions';
import { StatusBadge } from '@/components/status-badge';

/**
 * Der Satz zu einem Befund. Er stand bis zum 2026-09-15 als Template-Literal
 * hier — sechs deutsche Sätze, die kein Wächter sah, weil er nur einfache
 * Zeichenketten prüfte.
 */
export function findingText(f: Finding, t: ReturnType<typeof useTranslations<'site.template'>>): string {
  const name = f.label ?? f.path;
  switch (f.kind) {
    case 'added':
      return t('finding.added', { name });
    case 'renamed':
      return t('finding.renamed', { name, from: f.from });
    case 'removed':
      return f.filled > 0 ? t('finding.removedFilled', { name, count: f.filled }) : t('finding.removed', { name });
    case 'retyped':
      return t(f.lossless ? 'finding.retyped' : 'finding.retypedLossy', { name, from: f.from, to: f.to });
    case 'overLimit':
      return t('finding.overLimit', { name, have: f.have, max: f.max });
    case 'valueGone':
      return t('finding.valueGone', { name, value: f.value, replacement: f.replacement, count: f.count });
    case 'unknownImagePlace':
      return t('finding.unknownImagePlace', { name });
    default:
      return name;
  }
}

export function SyncClient({ name }: { name: string | null }) {
  const t = useTranslations('site.template');
  const [state, setState] = useState<SyncPreviewState>({ status: 'idle' });
  const [pending, start] = useTransition();
  const [applying, startApply] = useTransition();
  const applyFb = useActionFeedback();

  const preview = () => start(async () => setState(await previewSyncAction()));
  const apply = () =>
    startApply(async () => {
      const result = await applyFb.run(() => applySyncAction(), { retry: apply });
      if (result.status === 'success') setState({ status: 'idle' });
    });

  const p = state.status === 'preview' ? state.preview : null;
  const blocking = p?.blocking ?? [];
  const lossy = (p?.findings ?? []).filter((f) => f.kind !== 'overLimit' && losesContent(f));
  const harmless = (p?.findings ?? []).filter((f) => f.kind !== 'overLimit' && !losesContent(f));

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-4">
        <span className="text-body text-ink-2">{name ? t('name') + ': ' + name : t('neverRead')}</span>
        {/* Seltener Vorgang: `outline` statt primär (10 A4). */}
        <Button type="button" variant="outline" onClick={preview} disabled={pending}>{t('read')}</Button>
      </div>

      <RefusalNotice action state={state.status === 'error' ? { status: 'error', message: state.message, fieldErrors: {} } : { status: 'idle' }} />

      {p ? (
        <section aria-label={t('findings')} className="flex flex-col gap-3 border-t border-line pt-4">
          {p.localesMissing.length > 0 ? (
            <Notice level="refuse" remedies={[{ label: t('localesMissingRemedy'), href: '/admin/locales' }]}>
              {t('localesMissing', { locales: p.localesMissing.join(', ') })}
            </Notice>
          ) : null}

          {blocking.length > 0 ? (
            <div>
              <StatusBadge tone="error">{t('blocking')}</StatusBadge>
              <ul className="mt-1 list-disc pl-5 text-meta">{blocking.map((f, i) => <li key={i}>{findingText(f, t)}</li>)}</ul>
            </div>
          ) : null}

          {lossy.length > 0 ? (
            <div>
              <StatusBadge tone="warning">{t('lossy')}</StatusBadge>
              <ul className="mt-1 list-disc pl-5 text-meta">{lossy.map((f, i) => <li key={i}>{findingText(f, t)}</li>)}</ul>
            </div>
          ) : null}

          {harmless.length > 0 ? (
            <div>
              <StatusBadge tone="neutral">{t('harmless')}</StatusBadge>
              <ul className="mt-1 list-disc pl-5 text-meta text-ink-2">{harmless.map((f, i) => <li key={i}>{findingText(f, t)}</li>)}</ul>
            </div>
          ) : null}

          {p.findings.length === 0 && p.localesMissing.length === 0 ? <p className="text-meta text-muted-ink">{t('noFindings')}</p> : null}

          <RefusalNotice action state={applyFb.state} />
          <div className="flex gap-2 pt-1">
            <Button type="button" onClick={apply} disabled={applying || blocking.length > 0 || p.localesMissing.length > 0}>{t('apply')}</Button>
            <Button type="button" variant="ghost" onClick={() => setState({ status: 'idle' })}>{t('cancel')}</Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
