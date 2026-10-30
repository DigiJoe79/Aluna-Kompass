'use client';

import type { AnnualAccountsState } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { RequirementList, type RequirementListItem } from '@/components/requirement-list';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { RowMenu } from '@/components/row-menu';
import { Section } from '@/components/section';
import { Button, buttonVariants } from '@/components/ui/button';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { publishAnnualAccountsAction } from './actions';
import { ExplanationDialog } from './explanation-dialog';
import { PublishDialog } from './publish-dialog';
import { WithdrawDialog } from './withdraw-dialog';
import { RequestSignatureDialog } from './request-signature-dialog';
import { ScanDialog } from './scan-dialog';
import { SignDialog } from './sign-dialog';
import { doneCount, publicationRows, type PublicationRow, type RowAction, type RowKey, type Viewer } from './publication-rows';

/** Werte einer Unterzeile, die Tage sind (ISO); die Karte schreibt sie über `fmt.date`. */
const DATE_VALUES = ['date'];

/**
 * Karte „Webseite“ an der Jahresrechnung (Designer 1a–1c; Überschrift „Webseite“ statt „Veröffentlichung“ nach
 * Begriffsregel, Plan U1 Entscheidungen): drei Zeilen als `RequirementList variant="rows"` — Erläuterung, Abzeichnung,
 * Webseite —, rechts im Kopf „n von 3 erledigt“. Je Zeile die erste Aktion als Knopf, weitere im ⋯ (`RowMenu`); am
 * Telefon steht die offene Zeile zuerst. Die Dialoge der Aktionen hängen an `open`.
 */
export function PublicationCard({
  state,
  me,
  names,
  explanation,
  organizationName,
  today,
}: {
  state: AnnualAccountsState;
  me: Viewer;
  /** Namen der Konten, die um Abzeichnung gebeten haben. */
  names: Record<string, string>;
  /** Text und Stand der Erläuterung für den Dialog. */
  explanation: { text: string; updatedAt: string | null };
  /** Name des Vereins für den Satz der Abzeichnung. */
  organizationName: string;
  /** Heute in der Vereinszone (ISO-Tag): Tag der Abzeichnung, Vorgaben der Daten. */
  today: string;
}) {
  const t = useTranslations('finance.reports.annualAccounts.card');
  const tList = useTranslations('common.requirements');
  const tErrors = useTranslations('finance.errors');
  const fmt = useDateFormat();
  const rows = publicationRows(state, me);
  const [open, setOpen] = useState<{ row: RowKey; action: RowAction } | null>(null);
  const close = () => setOpen(null);
  const isOpen = (...actions: RowAction[]) => open !== null && actions.includes(open.action);
  // Wer selbst abzeichnet: der Eintrag des eigenen Kontos unter den Vertretern (Name und Amt aus der Rolle).
  const signer = state.signature.representatives.find((r) => r.userId !== null && r.userId === me.userId) ?? null;
  const router = useRouter();
  const publishing = useActionFeedback();
  const [publishPending, setPublishPending] = useState(false);
  // Nach der MV ist Bereitstellen ein Klick ohne Dialog (Designer 1e); die Ablehnung steht über der Karte.
  const publishNow = async () => {
    if (publishPending) return;
    setPublishPending(true);
    const result = await publishing.run(() => publishAnnualAccountsAction({ reportId: state.finalVersion!.reportId }), { retry: () => void publishNow() });
    setPublishPending(false);
    if (result.status === 'success') router.refresh();
  };
  const onAction = (row: RowKey, action: RowAction) => {
    if (action === 'publish' && state.website.publishNeeds !== 'reason') return void publishNow();
    setOpen({ row, action });
  };

  const detailOf = (row: PublicationRow): string | undefined => {
    if (!row.detail) return undefined;
    if (row.detail === 'blocked') return tErrors(`${String(row.values.code)}.reason`);
    const values: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(row.values)) values[k] = DATE_VALUES.includes(k) ? fmt.date(String(v)) : v;
    if (row.detail === 'requestedYou') values.name = names[String(row.values.requesterUserId)] ?? '';
    if (row.detail === 'signed' || row.detail === 'signedScan') values.hasOffice = row.values.office ? 'yes' : 'no';
    return t(`detail.${row.detail}`, values);
  };

  const actionNode = (row: PublicationRow, action: RowAction) =>
    action === 'goToSite' ? (
      <Link key={action} href="/site/publish" data-slot="button" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
        {t('actions.goToSite')}
      </Link>
    ) : (
      <Button key={action} type="button" variant="outline" size="sm" disabled={action === 'publish' && publishPending} onClick={() => onAction(row.key, action)} data-testid={`annual-accounts-${action}`}>
        {t(`actions.${action}`)}
      </Button>
    );

  const items: RequirementListItem[] = rows.map((row) => {
    const [first, ...more] = row.actions;
    const title = t(`rows.${row.key}`);
    const extra =
      first || row.link ? (
        <>
          {row.link ? (
            <Link href={row.link.href} className="text-link underline-offset-2 hover:underline">
              {row.link.label}
            </Link>
          ) : null}
          {first ? actionNode(row, first) : null}
          {more.length > 0 ? <RowMenu name={title} items={more.map((a) => ({ key: a, label: t(`actions.${a}`), onSelect: () => onAction(row.key, a), testId: `annual-accounts-${a}` }))} /> : null}
        </>
      ) : undefined;
    return {
      key: row.key,
      title,
      done: row.show === 'done',
      blocked: row.show === 'muted',
      blockedText: row.mutedReason ? t(`muted.${row.mutedReason}`) : undefined,
      detail: detailOf(row),
      canSelf: row.actions.length > 0 || row.link !== null,
      canDoNames: row.key === 'signature' && row.show === 'open' && row.actions.length === 0 ? state.signature.representatives.map((r) => r.name) : [],
      canDoText: t('canDo'),
      href: null,
      actionLabel: '',
      doneLabel: t('done'),
      extra,
    };
  });

  return (
    <FormCard as="section" data-testid="annual-accounts-card">
      <FormCardBody>
      <Section title={t('title')} actions={<span className="text-meta text-muted-ink">{tList('count', { done: doneCount(rows), total: 3 })}</span>}>
        <RefusalNotice action state={publishing.state} />
        <RequirementList variant="rows" items={items} openFirstOnPhone />
      </Section>
      </FormCardBody>
      <ExplanationDialog
        open={isOpen('write', 'edit', 'view')}
        onOpenChange={(o) => (o ? undefined : close())}
        fiscalYearId={state.fiscalYearId}
        designation={state.designation}
        text={explanation.text}
        updatedAt={explanation.updatedAt}
        mode={open?.action === 'view' ? 'view' : 'edit'}
      />
      {state.finalVersion ? (
        <>
          {signer ? (
            <SignDialog
              open={isOpen('sign')}
              onOpenChange={(o) => (o ? undefined : close())}
              reportId={state.finalVersion.reportId}
              designation={state.designation}
              finalizedAt={state.finalVersion.finalizedAt}
              shortHash={state.finalVersion.shortHash}
              organization={organizationName}
              signer={signer}
              today={today}
            />
          ) : null}
          <RequestSignatureDialog
            open={isOpen('request')}
            onOpenChange={(o) => (o ? undefined : close())}
            reportId={state.finalVersion.reportId}
            designation={state.designation}
            documentNumber={state.finalVersion.documentNumber}
            representatives={state.signature.representatives}
            meUserId={me.userId}
            today={today}
          />
          <PublishDialog open={isOpen('publish')} onOpenChange={(o) => (o ? undefined : close())} reportId={state.finalVersion.reportId} designation={state.designation} />
          <WithdrawDialog open={isOpen('withdraw', 'retract')} onOpenChange={(o) => (o ? undefined : close())} reportId={state.finalVersion.reportId} designation={state.designation} live={Boolean(state.website.publication?.liveSince)} />
          <ScanDialog open={isOpen('scan')} onOpenChange={(o) => (o ? undefined : close())} reportId={state.finalVersion.reportId} representatives={state.signature.representatives} today={today} />
        </>
      ) : null}
    </FormCard>
  );
}
