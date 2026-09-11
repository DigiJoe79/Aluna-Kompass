'use client';

import { losesContent, type Finding } from '@kompass/module-site/client';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { applySyncAction, previewSyncAction, type SyncPreviewState } from '../actions';

function findingText(f: Finding): string {
  const name = f.label ?? f.path;
  switch (f.kind) {
    case 'added':
      return `${name} wird leer angelegt`;
    case 'renamed':
      return `${name} übernimmt den Inhalt von ${f.from}`;
    case 'removed':
      return `${name} entfällt${f.filled > 0 ? ` — ${f.filled}× gefüllt` : ''}`;
    case 'retyped':
      return `${name} wechselt den Typ (${f.from} → ${f.to})${f.lossless ? '' : ' — Inhalt geht verloren'}`;
    case 'overLimit':
      return `${name} hat ${f.have} Einträge, erlaubt sind ${f.max}`;
    case 'valueGone':
      return `${name}: „${f.value}“ entfällt und wird zu „${f.replacement}“ (${f.count}×)`;
    default:
      return name;
  }
}

export function SyncClient({ name }: { name: string | null }) {
  const t = useTranslations('site.template');
  const [state, setState] = useState<SyncPreviewState>({ status: 'idle' });
  const [pending, start] = useTransition();
  const [applying, startApply] = useTransition();

  const preview = () => start(async () => setState(await previewSyncAction()));
  const apply = () =>
    startApply(async () => {
      const result = await applySyncAction();
      if (result.status === 'success') {
        toast.success(result.message ?? '');
        setState({ status: 'idle' });
      } else if (result.status === 'error') {
        toast.error(result.message);
      }
    });

  const p = state.status === 'preview' ? state.preview : null;
  const blocking = p?.blocking ?? [];
  const lossy = (p?.findings ?? []).filter((f) => f.kind !== 'overLimit' && losesContent(f));
  const harmless = (p?.findings ?? []).filter((f) => f.kind !== 'overLimit' && !losesContent(f));

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-6">
      <div className="flex items-center justify-between gap-4">
        <span className="text-[14px] text-ink-2">{name ? t('name') + ': ' + name : t('neverRead')}</span>
        <Button type="button" onClick={preview} disabled={pending}>{t('read')}</Button>
      </div>

      {state.status === 'error' ? <p role="alert" className="text-[13px] font-semibold text-error">{state.message}</p> : null}

      {p ? (
        <section aria-label={t('findings')} className="flex flex-col gap-3 border-t border-subtle pt-4">
          {p.localesMissing.length > 0 ? (
            <p className="rounded-md border border-error bg-error-surface p-3 text-[13px] font-semibold text-error">
              {t('localesMissing', { locales: p.localesMissing.join(', ') })}
            </p>
          ) : null}

          {blocking.length > 0 ? (
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-[.04em] text-error">{t('blocking')}</p>
              <ul className="mt-1 list-disc pl-5 text-[13px]">{blocking.map((f, i) => <li key={i}>{findingText(f)}</li>)}</ul>
            </div>
          ) : null}

          {lossy.length > 0 ? (
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-[.04em] text-warning">{t('lossy')}</p>
              <ul className="mt-1 list-disc pl-5 text-[13px]">{lossy.map((f, i) => <li key={i}>{findingText(f)}</li>)}</ul>
            </div>
          ) : null}

          {harmless.length > 0 ? (
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-[.04em] text-muted-ink">{t('harmless')}</p>
              <ul className="mt-1 list-disc pl-5 text-[13px] text-ink-2">{harmless.map((f, i) => <li key={i}>{findingText(f)}</li>)}</ul>
            </div>
          ) : null}

          {p.findings.length === 0 && p.localesMissing.length === 0 ? <p className="text-[13px] text-muted-ink">{t('noFindings')}</p> : null}

          <div className="flex gap-2 pt-1">
            <Button type="button" onClick={apply} disabled={applying || blocking.length > 0 || p.localesMissing.length > 0}>{t('apply')}</Button>
            <Button type="button" variant="ghost" onClick={() => setState({ status: 'idle' })}>{t('cancel')}</Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
