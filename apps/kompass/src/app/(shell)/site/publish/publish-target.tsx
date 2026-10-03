import { Globe } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';

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
      <Badge variant="outline" className="h-6 gap-1.5 px-2.5 text-[12px]">
        <Globe aria-hidden />
        {t(`target.${env}`)}
      </Badge>
      {publicUrl ? (
        <a href={publicUrl} target="_blank" rel="noreferrer" className="text-link underline">
          {host}
        </a>
      ) : null}
    </p>
  );
}
