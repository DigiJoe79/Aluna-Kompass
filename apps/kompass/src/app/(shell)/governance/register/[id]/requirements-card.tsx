'use client';

import type { FilingContext } from '@kompass/module-governance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useDateFormat } from '@/components/date-format-provider';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { RequirementList, type RequirementListItem } from '@/components/requirement-list';
import { Section } from '@/components/section';
import { Button } from '@/components/ui/button';
import type { FilingDialog } from './dialogs';

const link = 'text-link underline-offset-2 hover:underline';

/** Unterlagen (Board 8b): Pflicht und empfohlen in einer Liste als Zeilen; offen „Beifügen“. */
export function RequirementsCard({ context, manage, open }: { context: FilingContext; manage: boolean; open: (d: FilingDialog) => void }) {
  const t = useTranslations('governance.register.requirements');
  const { date } = useDateFormat();
  const meetingId = context.occasions.find((o) => o.meetingId)?.meetingId ?? null;
  const items: RequirementListItem[] = context.requirements.map((r) => {
    const title = t('title', { name: t(`keys.${r.key}`), level: r.level });
    const docs = r.documentIds.map((id) => ({ id, ...(context.documents[id] ?? { number: null, subject: '', documentDate: null }) }));
    const extra = r.met ? (
      <span className="flex flex-wrap gap-2">{docs.map((d) => <Link key={d.id} className={`${link} font-mono`} href={`/dms/${d.id}`}>{d.number ?? d.subject}</Link>)}</span>
    ) : r.key === 'registerData' && meetingId ? (
      <Link className={link} href={`/governance/meetings/${meetingId}#step-minutes`}>{t('issueAtMeeting')}</Link>
    ) : manage ? (
      <Button type="button" variant="outline" size="sm" onClick={() => open({ kind: 'attach', key: r.key, title: t(`keys.${r.key}`) })}>{t('attach')}</Button>
    ) : undefined;
    return { key: r.key, title, done: r.met, blocked: false, canSelf: true, canDoNames: [], canDoText: '', href: null, actionLabel: '', doneLabel: t('done'), detail: r.met && docs[0]?.documentDate ? date(docs[0].documentDate) : undefined, extra };
  });
  return (
    <FormCard as="section">
      <FormCardBody>
        <Section title={t('section')} intro={t('intro')}>
          <RequirementList variant="rows" items={items} />
        </Section>
      </FormCardBody>
    </FormCard>
  );
}
