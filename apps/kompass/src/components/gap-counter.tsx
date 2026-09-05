import { useTranslations } from 'next-intl';

export function GapCounter({ count }: { count: number }) {
  const t = useTranslations('website.common');
  return <span className={count > 0 ? 'rounded-sm bg-warning-bg px-2 py-0.5 text-[12px] font-semibold text-warning' : 'text-[12px] text-muted-ink'}>{t('gaps', { count })}</span>;
}
