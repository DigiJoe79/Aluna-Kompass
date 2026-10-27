import { hasPermission, todayIn } from '@kompass/core';
import type { LocalizedText } from '@kompass/core';
import { displayName, getContact } from '@kompass/module-contacts';
import { CERTIFIABLE_INCOME_KINDS, correctionTaxCodesInternal, getEntry, getEntryHistory, listAccounts, listCategories, listConfirmations, listFiscalYears, listOpenItems, listPurposes, listVatPeriods, vatLineContextInternal } from '@kompass/module-finance';
import { listProjects } from '@kompass/module-projects';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AmountCell } from '@/components/finance/amount-cell';
import { ConfirmationSection, type ConfirmationSectionLine } from '@/components/finance/confirmation-section';
import { EntryStateBadge } from '@/components/finance/entry-state-badge';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { lockLineText } from '@/lib/finance/lock-line';
import { dateFormatOf } from '@/lib/date-format';
import { formatEuro } from '@/lib/finance/amount';
import { taxTextKey } from '@/lib/finance/tax-text';
import { vatPeriodLabel } from '@/lib/finance/vat-period';
import { vatPeriodOf, vatTaxPointOn } from '@kompass/module-finance/vat-calendar';
import { Fragment } from 'react';
import { voucherDetails } from '@/lib/finance/voucher-details';
import { readAllPages } from '@/lib/read-all-pages';
import { requireSession } from '@/lib/request-context';
import { CorrectDialog } from './correct-dialog';
import { EntryActions } from './entry-actions';
import { EntryHistory } from './history';
import { NotReturnCard } from './not-return';
import { EntryVouchers } from './vouchers';
import { EntrySampleLine } from './entry-audit';
import { RemarksCard } from '@/app/(shell)/finance/audit/remarks-card';
import { AUDIT_SECTION_ORDER, isAuditSection } from '@/lib/finance/audit-sections';
import { loadEntryAudit } from '@/lib/finance/entry-audit';
import { Section } from '@/components/section';
import { Empty } from '@/components/empty-value';

export default async function ViewFinanceEntryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; section?: string; year?: string }> }) {
  const { id } = await params;
  const query = await searchParams;
  const { deps, ctx } = await requireSession();

  const entryRes = await getEntry(deps, ctx, { id });
  if (!entryRes.ok) {
    if (entryRes.error.type === 'forbidden') return <Page width="standard"><ForbiddenCard permission="finance.read" /></Page>;
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
  const yearStatus = entry.fiscalYearId !== null && fiscalYearsRes.ok ? fiscalYearsRes.value.find((y) => y.id === entry.fiscalYearId)?.status : undefined;
  const closedYear = yearStatus === 'closed';

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
  const tRoot = await getTranslations();
  const events = historyRes.ok ? historyRes.value.events : [];
  const finalizedEvent = events.find((e) => e.kind === 'finalized');
  // Rechte wie die Dienste (Designer Runde 5, 265/267): Korrigieren und Widerrufen `requestAllocationCorrection` bzw.
  // `revokeVoucher` (`finance.entriesFinalize`), Nachreichen `uploadVoucher` (`finance.entriesWrite`). Prüfer haben
  // keins davon und sehen nur „Öffnen“.
  const canCorrect = hasPermission(ctx, 'finance.entriesFinalize');
  // Sind Namen verborgen (ohne `contacts.view`), fällt die Spalte „Spender/Empfänger“ weg statt leer zu stehen (267).
  const showContacts = hasPermission(ctx, 'contacts.view');
  const reversed = entry.status === 'final' && entry.reversedByEntryId !== null;

  // „Hängt zusammen mit“ (Task 4): jede offene Zahlung, die eine Geldzeile dieser Buchung begleicht.
  const settlementItemIds = new Set(entry.moneyLines.flatMap((l) => l.settlements.map((s) => s.openItemId)));
  // Alle Posten lesen, nicht die jüngsten 200: Sonst fehlte einem älteren Posten die Beschriftung.
  const openItemsRes = settlementItemIds.size > 0 ? await readAllPages((page) => listOpenItems(deps, ctx, { state: 'all', ...page }), (v) => v.items) : null;
  const openItemById = new Map((openItemsRes?.ok ? openItemsRes.value : []).filter((i) => settlementItemIds.has(i.id)).map((i) => [i.id, i]));
  const settlements = entry.moneyLines.flatMap((line) => line.settlements.map((s) => ({ settlement: s, item: openItemById.get(s.openItemId) })));

  // Abschnitt „Bestätigung“ (F6a Task 7): je bescheinigungsfähiger Zeile die gültige Bestätigung, gelesen über die Liste des Kontakts.
  const incomeKinds = new Map(categories.map((c) => [c.id, c.incomeKind]));
  const certifiableLines = entry.allocationLines.filter((l) => l.amountCents > 0 && (CERTIFIABLE_INCOME_KINDS as readonly string[]).includes(incomeKinds.get(l.categoryId) ?? ''));
  const confirmationByLine = new Map<string, { id: string; number: string; issuedOn: string }>();
  const confirmationContacts = [...new Set(certifiableLines.map((l) => l.contactId).filter((v): v is string => !!v))];
  const confirmationLists = await Promise.all(confirmationContacts.map((contactId) => readAllPages((page) => listConfirmations(deps, ctx, { tab: 'issued', contactId, ...page }), (v) => v.items)));
  for (const list of confirmationLists) {
    if (!list.ok) continue;
    for (const c of list.value) {
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
  const today = todayIn(deps);
  const vatContext = vatLineContextInternal(deps.db, today);
  // AC, Befund 30 b: nur eine Auszahlung, die nach der Regel der Sperre ein möglicher Rückläufer bescheinigbarer Zuwendungen ist (Dienst), bis sie verknüpft oder als „keine Rückgabe“ gekennzeichnet ist.
  const paysDonor = entry.mayBeReturn === true;

  // 07-2 A5: Nummer einmal, daneben der Betreff aus der Akte.
  const voucherDocs = await voucherDetails(deps, ctx, entry.vouchers.map((v) => v.documentId));
  const vouchers = entry.vouchers.map((v) => ({
    linkId: v.linkId,
    documentNumber: v.documentNumber,
    title: voucherDocs.get(v.documentId)?.subject ?? '',
    typeLabel: voucherDocs.get(v.documentId)?.typeLabel ?? '',
    date: voucherDocs.get(v.documentId)?.date ?? entry.entryDate,
    viewHref: `/finance/entries/${id}/voucher/${v.documentId}`,
    revoked: v.revokedAt !== null,
    replacedByNumber: v.replacedByLinkId ? (entry.vouchers.find((o) => o.linkId === v.replacedByLinkId)?.documentNumber ?? null) : null,
  }));

  // E6a Task 11c (Board 4a): die abgegebenen Voranmeldungen um den Buchungstag — für den Hinweis auf die Berichtigung.
  const filedVatPeriods: Record<string, string> = {};
  if (!reversed && canCorrect) {
    const year = Number(entry.entryDate.slice(0, 4));
    for (const y of [year - 1, year]) {
      const periods = await listVatPeriods(deps, ctx, { year: y });
      if (!periods.ok) continue;
      for (const p of periods.value.advance) {
        const last = p.filings.at(-1);
        if (last) filedVatPeriods[p.key] = last.filedOn;
      }
    }
  }

  // Wie der Dienst (`ledger/reverse.ts`): im offenen Geschäftsjahr am Datum der Buchung, sonst heute.
  const reversalDate = yearStatus === 'open' ? entry.entryDate : today;
  const correct = !reversed && canCorrect ? (
    <CorrectDialog
      entry={entry}
      purposes={purposes}
      projects={projects}
      contactNames={contactNames}
      categoryNames={categoryNames}
      confirmations={Object.fromEntries(confirmationByLine)}
      canVoidConfirmation={hasPermission(ctx, 'finance.donationsIssue')}
      quiet={closedYear}
      filedVatPeriods={filedVatPeriods}
      vatContext={vatContext}
      taxCodeOptions={Object.fromEntries(entry.allocationLines.filter((l) => l.amountCents < 0).map((l) => [l.id, correctionTaxCodesInternal(deps.db, { entryDate: entry.entryDate, taxCode: l.taxCode, contactId: l.contactId })]))}
    />
  ) : null;
  const actions = canCorrect ? (
    <EntryActions entry={{ id: entry.id, number: entry.number, isReversal: !!entry.reversesEntryId, reversed }} reversalDate={reversalDate}>
      {correct}
    </EntryActions>
  ) : undefined;

  // Runde 3, 089: Die Marke „festgeschrieben“ steht neben der Nummer; Zeit, Person und Weg stehen als Unterzeile darunter
  // statt als zweiter Kasten mit Schloss.
  const tLock = await getTranslations('finance.lockLine');
  const tChannel = await getTranslations('finance.channel');
  const lockLine =
    finalizedEvent && finalizedEvent.kind === 'finalized'
      ? lockLineText((key, values) => tLock(key, values), (key) => tChannel(key), finalizedEvent, dateFormatOf(deps))
      : undefined;

  // Kassenprüfung (Board 4c, 9b): Stichprobe und Vermerke; aus dem Prüfpaket zurück auf den Abschnitt.
  const designation = (entry.fiscalYearId !== null && fiscalYearsRes.ok ? fiscalYearsRes.value.find((y) => y.id === entry.fiscalYearId)?.designation : undefined) ?? '';
  const audit = await loadEntryAudit(deps, ctx, { id: entry.id, number: entry.number, text: entry.text, voucherIds: entry.vouchers.filter((v) => v.revokedAt === null).map((v) => v.documentId).filter((d): d is string => Boolean(d)), designation });
  const tAudit = await getTranslations('finance.audit');
  const fromAudit = query.from === 'audit' && query.section && isAuditSection(query.section) && query.year ? { section: query.section, year: query.year } : null;
  const back = fromAudit
    ? { href: `/finance/audit/${fromAudit.section}?year=${encodeURIComponent(fromAudit.year)}`, label: tAudit('package.numbered', { n: AUDIT_SECTION_ORDER.indexOf(fromAudit.section) + 1, title: tAudit(`sections.${fromAudit.section}.title`) }) }
    : { href: '/finance/entries', label: t('back') };

  return (
    <Page width="standard" header={<PageHeader back={back} title={entry.number ?? undefined} status={<EntryStateBadge entry={entry} />} description={lockLine} actions={actions} />}>
      <div className="space-y-4">
        <section className="space-y-2 rounded-md border border-line bg-surface p-4">
          {/* Nummer und Stand stehen im Seitenkopf (`PageHeader title`/`status`, Board § K Ziel 5). */}
          <p className="text-body text-ink">{entry.text}</p>
          {entry.purposeNegativeReason ? (
            <p data-testid="entry-purpose-negative-reason" className="text-meta text-ink-2">
              {t('purposeNegativeReason', { reason: entry.purposeNegativeReason })}
            </p>
          ) : null}
          {entry.boardAllowanceReason ? (
            <p data-testid="entry-board-allowance-reason" className="text-meta text-ink-2">
              {t('boardAllowanceReason', { reason: entry.boardAllowanceReason })}
            </p>
          ) : null}
          {reversed && entry.reversedByEntryId ? (
            <p className="text-meta text-ink-2">
              {t('reversedBy')} <Link className="underline" href={`/finance/entries/${entry.reversedByEntryId}`}>{t('open')}</Link>
            </p>
          ) : null}
          {entry.reversesEntryId ? (
            <p className="text-meta text-ink-2">
              {t('reverses')} <Link className="underline" href={`/finance/entries/${entry.reversesEntryId}`}>{t('open')}</Link>
            </p>
          ) : null}
          {audit ? <EntrySampleLine audit={audit} entryId={entry.id} /> : null}
        </section>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="space-y-4">
            <section className="rounded-md border border-line bg-surface p-4">
              <Section title={t('account')}>
                <div className="space-y-2">
                  <Table className="text-meta">
                    <TableBody>
                      {entry.moneyLines.map((line) => (
                        <TableRow key={line.id}>
                          <TableCell className="text-ink-2">{accountNames.get(line.accountId) ?? line.accountId}</TableCell>
                          <TableCell>
                            <AmountCell cents={line.amountCents} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </Section>
            </section>

            <section className="rounded-md border border-line bg-surface p-4">
              <Section title={t('allocation')}>
                <div className="space-y-2">
                  {/* 07-2 B20: Vier Spalten brauchen einen Kopf. */}
                  <Table data-testid="finance-allocation-table" className="text-meta">
                    <TableHeader>
                      <TableRow>
                        <TableHead col="title">{t('allocationColumns.category')}</TableHead>
                        {showContacts ? <TableHead col="meta">{t('allocationColumns.contact')}</TableHead> : null}
                        <TableHead col="meta">{t('allocationColumns.purpose')}</TableHead>
                        <TableHead col="amount" className="text-right">{t('allocationColumns.amount')}</TableHead>
                        <TableHead col="status"><span className="sr-only">{t('allocationColumns.state')}</span></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {entry.allocationLines.map((line) => {
                        // Designer Runde 8, 097: Die § 13b-Steuer steht als Satz unter der Zeile über die volle Breite, mit
                        // der Voranmeldung, in der sie zählt.
                        const owed = line.amountCents !== 0 && taxTextKey(line.tax)?.key === 'reverseCharge' ? taxTextKey(line.tax)! : null;
                        const period = owed ? vatPeriodOf(vatTaxPointOn({ taxCode: line.taxCode as Parameters<typeof vatTaxPointOn>[0]['taxCode'], entryDate: entry.entryDate, serviceDate: line.serviceDate ?? null }), vatContext.periodKinds[Number(entry.entryDate.slice(0, 4))] ?? 'quarter').key : null;
                        return (
                        <Fragment key={line.id}>
                        <TableRow>
                          <TableCell col="title" className="text-ink-2">{categoryNames.get(line.categoryId) ?? line.categoryId}</TableCell>
                          {showContacts ? <TableCell col="meta" className="text-ink-2">{line.contactId ? (contactNames.get(line.contactId) ?? '') : <Empty />}</TableCell> : null}
                          <TableCell col="meta" className="text-ink-2">{line.purposeId ? (purposeNames.get(line.purposeId) ?? '') : <Empty />}</TableCell>
                          <TableCell col="amount" className="whitespace-normal">
                            <AmountCell cents={line.amountCents} />
                            {line.amountCents !== 0 && taxTextKey(line.tax)?.key === 'included' ? (
                              <p className="text-right text-hint text-muted-ink">
                                {tTax('included', { amount: formatEuro(taxTextKey(line.tax)!.cents) })}
                              </p>
                            ) : null}
                          </TableCell>
                          <TableCell col="status" className="text-right text-hint">
                            {line.corrected ? <span className="text-info">{t('corrected')}</span> : null}
                            {line.pendingCorrectionId ? <span className="text-warning">{t('pendingCorrection')}</span> : null}
                          </TableCell>
                        </TableRow>
                        {owed && period ? (
                          <TableRow data-testid="reverse-charge-line">
                            <TableCell col="span" colSpan={showContacts ? 5 : 4} className="whitespace-normal text-hint text-muted-ink">
                              {tTax('reverseChargeLine', { amount: formatEuro(owed.cents), small: String(vatContext.taxation === 'smallBusiness') })}{' '}
                              <Link href={`/finance/vat?period=${encodeURIComponent(period)}`} className="text-link underline-offset-2 hover:underline">
                                {tTax('advanceReturn', { period: vatPeriodLabel(period, tRoot as never) })}
                              </Link>
                            </TableCell>
                          </TableRow>
                        ) : null}
                        </Fragment>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </Section>
            </section>

            {settlements.length > 0 ? (
              <section className="rounded-md border border-line bg-surface p-4">
                <Section title={t('related.title')}>
                  <div className="space-y-2">
                    <ul className="space-y-1.5 text-meta">
                      {settlements.map(({ settlement, item }) => (
                        <li key={settlement.id} className="flex items-center justify-between gap-2 border-b border-line-2 py-1 last:border-0">
                          {item ? (
                            <Link href={`/finance/open-items?tab=${item.kind}&item=${item.id}`} className="text-link underline">
                              {item.paymentReference ?? t('related.unnamedItem')}
                            </Link>
                          ) : (
                            <span className="text-ink-2">{t('related.unnamedItem')}</span>
                          )}
                          <span className="tabular-nums text-ink-2">
                            {t('related.settlement', { amount: formatEuro(settlement.amountCents), rest: formatEuro(item?.openCents ?? 0) })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </Section>
              </section>
            ) : null}

            {entry.status === 'final' && !entry.reversesEntryId ? (
              <ConfirmationSection lines={confirmationLines} canIssue={!reversed && hasPermission(ctx, 'finance.donationsIssue')} canDescribe={hasPermission(ctx, 'finance.entriesWrite')} today={today} />
            ) : null}

            {paysDonor ? <NotReturnCard entryId={id} mark={entry.notReturn} canMark={hasPermission(ctx, 'finance.entriesFinalize')} /> : null}

            {audit ? <RemarksCard audit={audit} /> : null}

            <EntryHistory events={events} fmt={dateFormatOf(deps)} />
          </div>

          <EntryVouchers today={today} entryId={id} vouchers={vouchers} closedYear={closedYear} yearDesignation={designation} entryNumber={entry.number} canRevoke={canCorrect} canUpload={hasPermission(ctx, 'finance.entriesWrite')} documentationState={entry.documentation.state} origin={entry.documentation.origin} />
        </div>
      </div>
    </Page>
  );
}
