'use client';

import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import type { ActionState } from '@/lib/actions';

export function PublishSwitch({ id, isPublished, action, label }: { id: string; isPublished: boolean; action: (id: string, next: boolean) => Promise<ActionState>; label?: string }) {
  const t = useTranslations('website.common');
  const [pending, start] = useTransition();
  return (
    <label className="flex items-center gap-2 text-[13px]">
      <Switch checked={isPublished} disabled={pending} aria-label={label ?? t('published')} onCheckedChange={(next) => start(async () => { const s = await action(id, next); if (s.status === 'error') toast.error(s.message); })} />
      <span className={isPublished ? 'text-success' : 'text-muted-ink'}>{isPublished ? t('published') : t('unpublished')}</span>
    </label>
  );
}
