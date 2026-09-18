'use client';

import { ArrowDown, ArrowUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { ActionState } from '@/lib/actions';

export function ReorderButtons({ ids, index, action }: { ids: string[]; index: number; action: (ids: string[]) => Promise<ActionState> }) {
  const t = useTranslations('content');
  const [pending, start] = useTransition();
  const move = (delta: number) => {
    const next = [...ids];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item!);
    start(async () => { const s = await action(next); if (s.status === 'error') toast.error(s.message); });
  };
  return (
    <span className="inline-flex gap-1">
      <Button variant="ghost" size="icon" aria-label={t('moveUp')} disabled={pending || index === 0} onClick={() => move(-1)}><ArrowUp className="size-4" /></Button>
      <Button variant="ghost" size="icon" aria-label={t('moveDown')} disabled={pending || index === ids.length - 1} onClick={() => move(1)}><ArrowDown className="size-4" /></Button>
    </span>
  );
}
