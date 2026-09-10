'use client';

import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { deleteContactAction } from '../actions';

export function RetentionPanel({
  contactId,
  holds,
  until,
  due,
  canManage,
}: {
  contactId: string;
  holds: { entity: string; id: string; label: string; until: string | null }[];
  until: string | null;
  due: boolean;
  canManage: boolean;
}) {
  const t = useTranslations('contacts');
  const [pending, startTransition] = useTransition();

  const handleDelete = () => {
    startTransition(async () => {
      await deleteContactAction(contactId);
    });
  };

  return (
    <section className="rounded-md border border-line bg-surface p-5">
      <h2 className="mb-3 text-[15px] font-semibold text-ink">{t('retention.title')}</h2>

      {holds.length > 0 ? (
        <div data-testid="retention-holds" className="space-y-1.5 text-[13px] text-ink-2">
          {holds.map((h) => (
            <div key={`${h.entity}:${h.id}`} className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-muted-ink" aria-hidden />
              <span>
                {h.label} — {h.until ? t('retention.heldUntil', { date: h.until }) : t('retention.heldPermanently')}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[13px] text-muted-ink">{t('retention.unknown')}</p>
      )}

      {canManage ? (
        <div className="mt-5 flex flex-col gap-2 border-t border-line-2 pt-4">
          <div className="flex items-center gap-4">
            <Button
              type="button"
              variant="outline"
              disabled={!due || pending}
              onClick={handleDelete}
              className="border-error text-error hover:bg-error-bg hover:text-error"
            >
              {t('retention.delete')}
            </Button>
            {!due ? (
              <span className="text-[12px] text-muted-ink">
                {holds.length > 0 ? t('retention.deleteBlocked') : t('retention.unknown')}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
