import type { PublishSummary } from '@kompass/module-site';
import { AlertTriangle, Check, Pause } from 'lucide-react';
import { useTranslations } from 'next-intl';

/** Das Ergebnis eines Publish: immer Symbol und Wort, nie nur Farbe. */
export function StatusMark({ status }: { status: PublishSummary['status'] }) {
  const t = useTranslations('site.publish.history.status');
  const Icon = status === 'success' ? Check : status === 'failed' ? AlertTriangle : Pause;
  const tone = status === 'success' ? 'text-success' : status === 'failed' ? 'text-error' : 'text-muted-ink';
  return (
    <span className={`inline-flex items-center gap-1.5 font-medium ${tone}`}>
      <Icon className="size-4 shrink-0" aria-hidden />
      {t(status)}
    </span>
  );
}
