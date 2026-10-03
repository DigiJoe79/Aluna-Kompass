'use client';

import type { PathList } from '@kompass/module-site';
import { useTranslations } from 'next-intl';

/** Die Liste ist auf die ersten Einträge gekürzt; `total` sagt, wie viele es sind. */
export function FileList({ list }: { list: PathList }) {
  const t = useTranslations('site.publish.diff');
  return (
    <ul className="flex flex-col gap-1 font-mono text-[12px]">
      {list.items.map((f) => (
        <li key={f}>{f}</li>
      ))}
      {list.truncated ? <li className="font-sans text-muted-ink">{t('more', { count: list.total - list.items.length })}</li> : null}
    </ul>
  );
}
