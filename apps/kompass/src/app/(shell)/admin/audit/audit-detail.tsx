'use client';

import type { AuditEntry } from '@kompass/core';
import { useTranslations } from 'next-intl';
import { useDateFormat } from '@/components/date-format-provider';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CopyButton } from '@/components/copy-button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { auditActionLabel } from '@/lib/audit-actions';
import { changedFieldsOf, diffFields } from '@/lib/audit-diff';

/** `sentence`: der Satz aus `auditSentences`; `null` (alter Eintrag, Aktion ohne Satz) → keine Zeile „Was geschah“. */
export function AuditDetail({ entry, sentence }: { entry: AuditEntry; sentence: string | null }) {
  const t = useTranslations('audit.detail');
  const a = useTranslations('audit');
  const f = useTranslations('audit.filters.channels');
  const fieldLabel = useTranslations('contacts.fields');
  const fmt = useDateFormat();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const close = () => {
    const next = new URLSearchParams(params.toString());
    next.delete('entry');
    router.replace(`${pathname}?${next.toString()}`);
  };
  const rows = diffFields(entry.before, entry.after);
  const changed = changedFieldsOf(entry.after);
  // D7: Feldnamen mit eigener Beschriftung des Protokolls (Nutzer), sonst der des Kontaktformulars, sonst der Schlüssel.
  const labelOf = (key: string) => (a.has(`fields.${key}`) ? a(`fields.${key}`) : fieldLabel.has(key) ? fieldLabel(key) : key);
  return (
    <Sheet
      open
      onOpenChange={(o) => {
        if (!o) close();
      }}
    >
      <SheetContent side="right" size="md" className="gap-0 overflow-y-auto bg-surface shadow-md">
        <div className="p-5">
          <SheetTitle>{auditActionLabel(a, entry.action)}</SheetTitle>
          <p className="mt-1 font-mono text-[12px] text-muted-ink">
            {fmt.dateTime(entry.occurredAt, { seconds: true })}
          </p>
          <div className="mt-4 flex flex-col gap-2">
            {changed !== null ? (
              <div className="rounded-md border border-line bg-surface-2 px-3 py-2.5 text-[13px]" data-testid="audit-changed-fields">
                <p>{t('changedFields', { fields: changed.map(labelOf).join(', ') })}</p>
                <p className="mt-1 text-[12px] text-muted-ink">{t('changedFieldsNote')}</p>
              </div>
            ) : null}
            {rows.length === 0 && changed === null ? <p className="text-[13px] text-muted-ink">{t('noDiff')}</p> : null}
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
              {entry.apiTokenId ? ` · ${entry.apiTokenName ?? t('tokenGone', { id: entry.apiTokenId })}` : ''}
            </dd>
            <dt className="text-muted-ink">{t('origin')}</dt>
            <dd className="font-mono">{entry.ipAddress ?? '—'}</dd>
            <dt className="text-muted-ink">{t('request')}</dt>
            <dd className="font-mono">{entry.requestId}</dd>
            <dt className="text-muted-ink">{t('environment')}</dt>
            <dd>{entry.environment}</dd>
            {sentence !== null ? (
              <>
                <dt className="text-muted-ink">{t('summary')}</dt>
                <dd>{sentence}</dd>
              </>
            ) : null}
            {/* Nebeninformation für Vorstand und Kassenprüfung, deshalb am Ende (Designer 2026-10-09). */}
            <dt className="text-muted-ink">{t('actionKey')}</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{entry.action}</span>
              <CopyButton value={entry.action} label={t('actionKey')} />
            </dd>
          </dl>
          <p className="mt-6 text-[12px] text-muted-ink">{t('immutable')}</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
