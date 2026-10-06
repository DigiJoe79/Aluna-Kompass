import type { SiteConnectionSummary } from '@kompass/module-site';
import { useTranslations } from 'next-intl';
import { RunCard } from '@/app/(shell)/site/publish/run-card';
import { ConnectionCard } from './connection-card';

/**
 * Die Werte stehen in der Umgebung des Containers, nicht in der Datenbank:
 * Das Panel zeigt sie nur. Geheimnisse erscheinen als „gesetzt“ oder „fehlt“.
 * Der Test braucht `site.publish` (Dienst); ohne dieses Recht bleibt das Panel lesend.
 */
export function ConnectionPanel({ summary, canPublish }: { summary: SiteConnectionSummary; canPublish: boolean }) {
  const t = useTranslations('site.admin.connection');
  const tAdmin = useTranslations('site.admin');
  const target = summary.target
    ? summary.target.host
      ? t('targetRemote', { user: summary.target.user, host: summary.target.host, path: summary.target.path })
      : t('targetLocal', { path: summary.target.path })
    : t('notConfigured');
  const rows: [string, string][] = [
    [t('publicUrl'), summary.publicUrl ?? t('none')],
    [t('target'), target],
    [t('auth'), t(`authValues.${summary.auth}`)],
    [t('secret'), summary.secret ? t(`secretValues.${summary.secret}`) : t('none')],
    [t('staging'), summary.staging ? t('yes') : t('no')],
  ];

  return (
    <>
      <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
        <h3 className="text-[15px] font-semibold">{t('title')}</h3>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-[13px]">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-ink">{label}</dt>
              <dd className="text-ink">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="max-w-prose text-[13px] text-ink-2">{t('envHint')}</p>
      </section>
      {!summary.ready ? (
        <p className="rounded-lg border border-line bg-surface p-5 text-[13px] text-ink-2" role="note">{t('notReady')}</p>
      ) : !canPublish ? (
        <p className="rounded-lg border border-line bg-surface p-5 text-[13px] text-ink-2" role="note">{tAdmin('needsPublish')}</p>
      ) : (
        <>
          <RunCard />
          <ConnectionCard />
        </>
      )}
    </>
  );
}
