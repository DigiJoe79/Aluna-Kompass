import { Globe } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { StatusBadge } from '@/components/status-badge';

/** Wohin diese Installation publiziert: Umgebung als Marke, die öffentliche Adresse als Link. */
export function PublishTarget({ env, publicUrl }: { env: string; publicUrl: string | null }) {
  const t = useTranslations('site.publish');
  let host: string | null = null;
  try {
    host = publicUrl ? new URL(publicUrl).host : null;
  } catch {
    host = publicUrl;
  }
  return (
    <p className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
      <StatusBadge tone="neutral" icon={Globe}>
        {t(`target.${env}`)}
      </StatusBadge>
      {publicUrl ? (
        <a href={publicUrl} target="_blank" rel="noreferrer" className="text-link underline">
          {host}
        </a>
      ) : null}
    </p>
  );
}
