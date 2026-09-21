import type { EntryHistoryEvent } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { BeforeAfter } from '@/components/before-after';

function summaryOf(event: EntryHistoryEvent, t: Awaited<ReturnType<typeof getTranslations>>): string {
  switch (event.kind) {
    case 'created':
      return t('events.created', { name: event.userName ?? t('unknownUser') });
    case 'reviewed':
      return t('events.reviewed', { name: event.userName ?? t('unknownUser') });
    case 'finalized':
      return t('events.finalized', { name: event.userName ?? t('unknownUser') });
    case 'reversed':
      return t('events.reversed', { number: event.byNumber ?? '' });
    case 'voucherAdded':
      return t('events.voucherAdded', { number: event.documentNumber });
    case 'voucherRevoked':
      return t('events.voucherRevoked', { number: event.documentNumber });
    case 'allocationChanged':
      return t(`events.allocationChanged.${event.state}`, { name: event.userName ?? t('unknownUser') });
  }
}

/** Der Verlauf einer Buchung, aus ihren Spalten (HANDOFF § 5.3) — nie aus dem Änderungsprotokoll. */
export async function EntryHistory({ events }: { events: EntryHistoryEvent[] }) {
  const t = await getTranslations('finance.entryView.history');
  if (events.length === 0) return null;

  return (
    <section className="space-y-3 rounded-md border border-line bg-surface p-4">
      <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-ink">{t('title')}</h3>
      <ul className="space-y-3">
        {events.map((event, index) => (
          <li key={index} className="space-y-1.5 border-t border-line-2 pt-2 first:border-0 first:pt-0">
            <p className="text-[13px]">
              <span className="mr-2 font-mono text-[12px] text-muted-ink">{event.at.slice(0, 16).replace('T', ' ')}</span>
              {summaryOf(event, t)}
            </p>
            {event.kind === 'allocationChanged' ? (
              <>
                <BeforeAfter
                  rows={[{ label: t('changeLabel'), before: <span>{JSON.stringify(event.before)}</span>, after: <span>{JSON.stringify(event.after)}</span> }]}
                />
                <p className="text-[13px] italic text-ink-2">„{event.note}“</p>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
