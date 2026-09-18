'use client';

import type { AuditEntry } from '@kompass/core';
import { useFormatter, useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { diffFields } from '@/lib/audit-diff';

export function AuditDetail({ entry }: { entry: AuditEntry }) {
  const t = useTranslations('audit.detail');
  const f = useTranslations('audit.filters.channels');
  const format = useFormatter();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const close = () => {
    const next = new URLSearchParams(params.toString());
    next.delete('entry');
    router.replace(`${pathname}?${next.toString()}`);
  };
  const rows = diffFields(entry.before, entry.after);
  return (
    <Sheet
      open
      onOpenChange={(o) => {
        if (!o) close();
      }}
    >
      <SheetContent side="right" className="w-[420px] bg-surface shadow-md">
        <SheetTitle className="font-heading text-[17px]">{entry.action}</SheetTitle>
        <p className="font-mono text-[12px] text-muted-ink">
          {format.dateTime(new Date(entry.occurredAt), { dateStyle: 'medium', timeStyle: 'medium' })}
        </p>
        <div className="mt-4 flex flex-col gap-2">
          {rows.length === 0 ? <p className="text-[13px] text-muted-ink">{t('noDiff')}</p> : null}
          {rows.map((row) => (
            <div key={row.key} className="rounded-md border border-line bg-surface-2 px-3 py-2.5">
              <div className="font-mono text-[11px] text-muted-ink">{row.key}</div>
              <div className="mt-1 grid grid-cols-[38px_minmax(0,1fr)] gap-1 font-mono text-[12px]">
                <span className="text-muted-ink">{t('before')}</span>
                <span className="rounded-sm bg-code px-1.5 text-muted-ink line-through">
                  {row.before ?? '—'}
                </span>
                <span className="text-muted-ink">{t('after')}</span>
                <span className="rounded-sm bg-success-bg px-1.5 font-semibold text-success">
                  {row.after ?? '—'}
                </span>
              </div>
            </div>
          ))}
        </div>
        <dl className="mt-4 grid grid-cols-[110px_minmax(0,1fr)] gap-y-1 text-[13px]">
          <dt className="text-muted-ink">{t('user')}</dt>
          <dd>{entry.userName ?? '—'}</dd>
          <dt className="text-muted-ink">{t('channel')}</dt>
          <dd>
            {f(entry.channel)}
            {entry.apiTokenId ? ` · ${entry.apiTokenId}` : ''}
          </dd>
          <dt className="text-muted-ink">{t('origin')}</dt>
          <dd className="font-mono">{entry.ipAddress ?? '—'}</dd>
          <dt className="text-muted-ink">{t('request')}</dt>
          <dd className="font-mono">{entry.requestId}</dd>
          <dt className="text-muted-ink">{t('environment')}</dt>
          <dd>{entry.environment}</dd>
          <dt className="text-muted-ink">{t('summary')}</dt>
          <dd>{entry.summary}</dd>
        </dl>
        <p className="mt-6 text-[12px] text-muted-ink">{t('immutable')}</p>
      </SheetContent>
    </Sheet>
  );
}
