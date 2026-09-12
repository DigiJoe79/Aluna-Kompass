'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { usePreference } from '@/lib/preferences';
import { cn } from '@/lib/utils';
import { completeDueAction } from './due-actions';

export interface DueItemView {
  id: string;
  dueAt: string;
  title: string;
  assigneeUserId: string | null;
  assigneeName: string | null;
  target: { label: string; href: string | null } | null;
}

/**
 * Was in den nächsten Tagen ansteht — über den Karten, weil es das Einzige auf
 * dieser Seite ist, das eine Frist hat. „Nur meine“ heißt: mir zugewiesen;
 * eine Wiedervorlage ohne Zuständige gilt allen und erscheint dort nicht.
 */
export function DuePanel({
  items,
  userId,
  today,
  canManage,
}: {
  items: DueItemView[];
  userId: string;
  today: string;
  canManage: boolean;
}) {
  const t = useTranslations('home.due');
  const router = useRouter();
  const [onlyMine, setOnlyMine] = usePreference('dueOnlyMine');
  const [, start] = useTransition();
  const shown = onlyMine ? items.filter((i) => i.assigneeUserId === userId) : items;

  return (
    <section data-testid="due-panel" className="rounded-lg border border-line bg-surface p-[18px]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-heading text-[17px]">{t('title')}</h3>
        <div className="flex items-center gap-2">
          <Switch id="due-only-mine" checked={onlyMine} onCheckedChange={setOnlyMine} />
          <Label htmlFor="due-only-mine" className="cursor-pointer text-[13px] text-ink-2">
            {t('onlyMine')}
          </Label>
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="text-[13px] text-muted-ink">{t('none')}</p>
      ) : (
        <ul className="divide-y divide-line-2">
          {shown.map((item) => (
            <li key={item.id} className="flex items-center gap-3 py-2 text-[13px]">
              {canManage ? (
                <Checkbox
                  aria-label={t('complete', { title: item.title })}
                  onCheckedChange={() =>
                    start(async () => {
                      const s = await completeDueAction(item.id);
                      if (s.status === 'error') toast.error(s.message);
                      else router.refresh();
                    })
                  }
                />
              ) : null}
              <span className={cn('font-mono text-[12px]', item.dueAt < today ? 'text-warning' : 'text-ink-2')}>
                {item.dueAt}
              </span>
              <span className="min-w-0 flex-1 truncate text-ink">{item.title}</span>
              {item.target ? (
                item.target.href ? (
                  <Link
                    href={item.target.href}
                    className="truncate font-mono text-[12px] underline underline-offset-2 hover:text-link"
                  >
                    {item.target.label}
                  </Link>
                ) : (
                  <span className="truncate font-mono text-[12px] text-muted-ink">{item.target.label}</span>
                )
              ) : null}
              {item.assigneeName ? <span className="text-[12px] text-muted-ink">{item.assigneeName}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
