'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

export function SaveBar({
  pendingCount,
  info,
  onDiscard,
  onSave,
  saving,
  saveLabel,
}: {
  pendingCount: number;
  info?: string;
  onDiscard: () => void;
  onSave: () => void;
  saving?: boolean;
  saveLabel?: string;
}) {
  const t = useTranslations('common');
  return (
    <div className="sticky bottom-0 mt-4 flex items-center gap-3 border-t border-line bg-surface-2 px-6 py-3">
      <span className={pendingCount > 0 ? 'text-[13px] font-semibold text-warning' : 'text-[13px] text-ink-2'}>
        {pendingCount > 0 ? t('changesPending', { count: pendingCount }) : info ?? ''}
      </span>
      <div className="ml-auto flex gap-2">
        <Button variant="ghost" onClick={onDiscard} disabled={pendingCount === 0 || saving}>
          {t('discard')}
        </Button>
        <Button onClick={onSave} disabled={pendingCount === 0 || saving}>
          {saveLabel ?? t('save')}
        </Button>
      </div>
    </div>
  );
}
