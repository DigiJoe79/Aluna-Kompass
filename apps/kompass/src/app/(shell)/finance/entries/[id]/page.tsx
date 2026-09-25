import { hasPermission } from '@kompass/core';
import type { LocalizedText } from '@kompass/core';
import { displayName, getContact } from '@kompass/module-contacts';
import { CERTIFIABLE_INCOME_KINDS, getEntry, getEntryHistory, listAccounts, listCategories, listConfirmations, listFiscalYears, listOpenItems, listPurposes } from '@kompass/module-finance';
import { listProjects } from '@kompass/module-projects';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AmountCell } from '@/components/finance/amount-cell';
import { ConfirmationSection, type ConfirmationSectionLine } from '@/components/finance/confirmation-section';
import { EntryStateBadge } from '@/components/finance/entry-state-badge';
import { LockLine } from '@/components/finance/lock-line';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { formatEuro } from '@/lib/finance/amount';
import { taxTextKey } from '@/lib/finance/tax-text';
import { requireSession } from '@/lib/request-context';
import { CorrectDialog } from './correct-dialog';
import { EntryHistory } from './history';
import { EntryVouchers } from './vouchers';

export default async function ViewFinanceEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { deps, ctx } = await requireSession();

  const entryRes = await getEntry(deps, ctx, { id });
  if (!entryRes.ok) {
    if (entryRes.error.type === 'forbidden') return <ForbiddenCard permission="finance.read" />;
    notFound();
  }
  const entry = entryRes.value;
  // Ein Entwurf hat kein Verlaufskapitel, keine Schloss-Zeile — er gehört auf die Maske (Global Constraint).
  if (entry.status === 'draft') redirect(`/finance/entries/${id}/edit`);

  const [historyRes, accountsRes, categoriesRes, purposesRes, projectsRes, fiscalYearsRes] = await Promise.all([
    getEntryHistory(deps, ctx, { id }),
    listAccounts(deps, ctx, {}),
    listCategories(deps, ctx, {}),
    listPurposes(deps, ctx, {}),
    listProjects(deps, ctx),
    listFiscalYears(deps, ctx),
  ]);
  const closedYear = entry.fiscalYearId !== null && (fiscalYearsRes.ok ? fiscalYearsRes.value.find((y) => y.id === entry.fiscalYearId)?.status === 'closed' : false);

  const accountNames = new Map((accountsRes.ok ? accountsRes.value : []).map((a) => [a.id, a.name]));
  const categories = categoriesRes.ok ? categoriesRes.value : [];
  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
  const purposes = purposesRes.ok ? purposesRes.value : [];
  const purposeNames = new Map(purposes.map((p) => [p.id, p.name]));
  const leading = deps.locales()[0] ?? 'de';
  const projects = (projectsRes.ok ? projectsRes.value : []).map((p) => ({ id: p.id, name: (p.name as LocalizedText)[leading] || p.slug }));

  const contactIds = new Set(entry.allocationLines.map((l) => l.contactId).filter((v): v is string => !!v));
  const contactNames = new Map<string, string>();
  await Promise.all(
    [...contactIds].map(async (cid) => {
      const res = await getContact(deps, ctx, cid);
      if (res.ok) contactNames.set(cid, displayName(res.value));
    }),
  );

  const t = await getTranslations('finance.entryView');
  const tTax = await getTranslations('finance.taxText');
  const events = historyRes.ok ? historyRes.value.events : [];
  const finalizedEvent = events.find((e) => e.kind === 'finalized');
  const canCorrect = hasPermission(ctx, 'finance.entriesFinalize');
  const reversed = entry.status === 'final' && entry.reversedByEntryId !== null;

  // „Hängt zusammen mit“ (Task 4): jede offene Zahlung, die eine Geldzeile dieser Buchung begleicht.
  const settlementItemIds = new Set(entry.moneyLines.flatMap((l) => l.settlements.map((s) => s.openItemId)));
  const openItemsRes = settlementItemIds.size > 0 ? await listOpenItems(deps, ctx, { state: 'all', limit: 200 }) : null;
  const openItemById = new Map((openItemsRes?.ok ? openItemsRes.value.items : []).filter((i) => settlementItemIds.has(i.id)).map((i) => [i.id, i]));
  const settlements = entry.moneyLines.flatMap((line) => line.settlements.map((s) => ({ settlement: s, item: openItemById.get(s.openItemId) })));

  // Abschnitt „Bestätigung“ (F6a Task 7): je bescheinigungsfähiger Zeile die gültige Bestätigung, gelesen über die Liste des Kontakts.
  const incomeKinds = new Map(categories.map((c) => [c.id, c.incomeKind]));
  const certifiableLines = entry.allocationLines.filter((l) => l.amountCents > 0 && (CERTIFIABLE_INCOME_KINDS as readonly string[]).includes(incomeKinds.get(l.categoryId) ?? ''));
  const confirmationByLine = new Map<string, { id: string; number: string; issuedOn: string }>();
  const confirmationContacts = [...new Set(certifiableLines.map((l) => l.contactId).filter((v): v is string => !!v))];
  const confirmationLists = await Promise.all(confirmationContacts.map((contactId) => listConfirmations(deps, ctx, { tab: 'issued', contactId, limit: 200 })));
  for (const list of confirmationLists) {
    if (!list.ok) continue;
    for (const c of list.value.items) {
      if (c.state !== 'valid') continue;
      for (const l of c.lines) if (l.releasedAt === null) confirmationByLine.set(l.lineId, { id: c.id, number: c.documentNumber, issuedOn: c.issuedOn });
    }
  }
  const confirmationLines: ConfirmationSectionLine[] = certifiableLines.map((l) => ({
    lineId: l.id,
    label: [categoryNames.get(l.categoryId) ?? l.categoryId, l.contactId ? (contactNames.get(l.contactId) ?? '') : null].filter((v): v is string => !!v).join(' · '),
    amountCents: l.amountCents,
    hasContact: l.contactId !== null,
    confirmation: confirmationByLine.get(l.id) ?? null,
  }));
  const today = deps.clock.now().toISOString().slice(0, 10);

  const vouchers = entry.vouchers.map((v) => ({
    linkId: v.linkId,
    documentNumber: v.documentNumber,
    title: v.documentNumber,
    typeLabel: '',
    date: entry.entryDate,
    viewHref: `/finance/entries/${id}/voucher/${v.documentId}`,
    revoked: v.revokedAt !== null,
    replacedByNumber: v.replacedByLinkId ? (entry.vouchers.find((o) => o.linkId === v.replacedByLinkId)?.documentNumber ?? null) : null,
  }));

  return (
    <div className="space-y-4">
      <PageHeader back={{ href: '/finance/entries', label: t('back') }} />
      <section className="space-y-2 rounded-md border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span data-testid="entry-number" className="font-mono text-[26px] font-semibold">{entry.number}</span>
          <EntryStateBadge entry={entry} />
        </div>
        <p className="text-[15px] text-ink">{entry.text}</p>
        {finalizedEvent && finalizedEvent.kind === 'finalized' ? (
          <LockLine at={finalizedEvent.at} userName={finalizedEvent.userName} channel={finalizedEvent.channel} />
        ) : null}
        {reversed && entry.reversedByEntryId ? (
          <p className="text-[13px] text-ink-2">
            {t('reversedBy')} <Link className="underline" href={`/finance/entries/${entry.reversedByEntryId}`}>{t('open')}</Link>
          </p>
        ) : null}
        {entry.reversesEntryId ? (
          <p className="text-[13px] text-ink-2">
            {t('reverses')} <Link className="underline" href={`/finance/entries/${entry.reversesEntryId}`}>{t('open')}</Link>
          </p>
        ) : null}
        {!reversed && canCorrect ? (
          <CorrectDialog
            entry={entry}
            purposes={purposes}
            projects={projects}
            contactNames={contactNames}
            categoryNames={categoryNames}
            confirmations={Object.fromEntries(confirmationByLine)}
            canVoidConfirmation={hasPermission(ctx, 'finance.donationsIssue')}
          />
        ) : null}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <section className="space-y-2 rounded-md border border-line bg-surface p-4">
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-ink">{t('account')}</h3>
            <table className="w-full text-[13px]">
              <tbody>
                {entry.moneyLines.map((line) => (
                  <tr key={line.id} className="border-b border-line-2 last:border-0">
                    <td className="py-1.5 text-ink-2">{accountNames.get(line.accountId) ?? line.accountId}</td>
                    <td className="py-1.5">
                      <AmountCell cents={line.amountCents} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="space-y-2 rounded-md border border-line bg-surface p-4">
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-ink">{t('allocation')}</h3>
            <table data-testid="finance-allocation-table" className="w-full text-[13px]">
              <tbody>
                {entry.allocationLines.map((line) => (
                  <tr key={line.id} className="border-b border-line-2 last:border-0">
                    <td className="py-1.5 text-ink-2">{categoryNames.get(line.categoryId) ?? line.categoryId}</td>
                    <td className="py-1.5 text-ink-2">{line.contactId ? (contactNames.get(line.contactId) ?? '') : '—'}</td>
                    <td className="py-1.5 text-ink-2">{line.purposeId ? (purposeNames.get(line.purposeId) ?? '') : '—'}</td>
                    <td className="py-1.5">
                      <AmountCell cents={line.amountCents} />
                      {line.amountCents !== 0 && taxTextKey(line.tax) ? (
                        <p className="text-right text-[12px] text-muted-ink">
                          {tTax(taxTextKey(line.tax)!.key, { amount: formatEuro(taxTextKey(line.tax)!.cents) })}
                        </p>
                      ) : null}
                    </td>
                    <td className="py-1.5 text-right text-[12px]">
                      {line.corrected ? <span className="text-info">{t('corrected')}</span> : null}
                      {line.pendingCorrectionId ? <span className="text-warning">{t('pendingCorrection')}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {settlements.length > 0 ? (
            <section className="space-y-2 rounded-md border border-line bg-surface p-4">
              <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-ink">{t('related.title')}</h3>
              <ul className="space-y-1.5 text-[13px]">
                {settlements.map(({ settlement, item }) => (
                  <li key={settlement.id} className="flex items-center justify-between gap-2 border-b border-line-2 py-1 last:border-0">
                    {item ? (
                      <Link href={`/finance/open-items?tab=${item.kind}&item=${item.id}`} className="text-link underline">
                        {item.paymentReference ?? t('related.unnamedItem')}
                      </Link>
                    ) : (
                      <span className="text-ink-2">{t('related.unnamedItem')}</span>
                    )}
                    <span className="font-mono tabular-nums text-ink-2">
                      {t('related.settlement', { amount: formatEuro(settlement.amountCents), rest: formatEuro(item?.openCents ?? 0) })}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {entry.status === 'final' && !entry.reversesEntryId ? (
            <ConfirmationSection lines={confirmationLines} canIssue={!reversed && hasPermission(ctx, 'finance.donationsIssue')} canDescribe={hasPermission(ctx, 'finance.entriesWrite')} today={today} />
          ) : null}

          <EntryHistory events={events} />
        </div>

        <EntryVouchers entryId={id} vouchers={vouchers} closedYear={closedYear} documentationState={entry.documentation.state} />
      </div>
    </div>
  );
}
