import { hasPermission, listUserNamesWithPermission, readSetting, todayIn, type DashboardLine, type DashboardTile } from '@kompass/core';
import { contacts, displayName } from '@kompass/module-contacts';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import { listApprovals } from './allocation/approvals';
import { listMyExpenseClaims } from './allocation/expenses';
import { positionViewsOf, sumPositionCents } from './allocation/partner-payments';
import { openProofsInternal, paymentsReadyToAcknowledgeInternal } from './allocation/partner-proof';
import { freeReserveCapOverview } from './allocation/reserves';
import { countNeedsSignatureInternal } from './donations/confirmations';
import { certifiableLineExistsInternal, noticeExpiryInternal, noticeValidAtInternal } from './donations/notices';
import { countToCorrectInternal } from './donations/to-correct';
import { countOpenRawTransactionsInternal, importedThroughInternal, reconcileBankInternal } from './import/queries';
import { listForeignMoney } from './import/transit';
import { formatEuro } from './ledger/cash-check';
import { valueAt } from './ledger/dated-values';
import { getSetupStatus } from './ledger/setup';
import { listEntries } from './ledger/entries';
import { overdueOpenItemsInternal } from './ledger/open-items';
import { accountBalancesAt, purposeBalancesAt } from './ledger/queries';
import { listVouchersWithoutEntry } from './ledger/vouchers';
import { financeAccounts, financeEntries, financeExpenseClaims, financePartnerPayments, financePartnerProfiles, financePurposes, financePurposeTransfers, type FinanceAccountRow } from './schema';

/**
 * Die zehn Kacheln der Startseite (F3b Task 6, F4 Task 6, F6a Task 5, Spec 9.7): je genau
 * ein Recht. `finance.todo` und `finance.setupIncomplete` sind in der
 * Vorgabe an — die übrigen Einzelkacheln (Beleg, Entwürfe, offene Zahlungen,
 * Zwecke, Import) bleiben aus, weil die Sammelkachel sie trägt.
 */

/** Entwürfe ab 14 Tagen sind „zu alt“ (Entschieden 3, F3b) — ab Tag 15, fester Wert. */
const STALE_DRAFT_DAYS = 14;

/** Ganze Tage zwischen zwei Datumsangaben (`YYYY-MM-DD`), für „letzter Auszug vor N Tagen“ (F4 Task 6). */
function daysBetween(today: string, date: string): number {
  return Math.round((Date.parse(`${today}T00:00:00.000Z`) - Date.parse(`${date}T00:00:00.000Z`)) / 86_400_000);
}

/** Aktive Bank- und Zahlungsdienstkonten — nur diese kennen einen Auszug (Spec 9.3, 9.7). */
function activeReconcilableAccounts(deps: Parameters<DashboardTile['load']>[0]): FinanceAccountRow[] {
  return deps.db.select().from(financeAccounts).where(and(eq(financeAccounts.isActive, true), or(eq(financeAccounts.kind, 'bank'), eq(financeAccounts.kind, 'paymentService')))).all();
}

/** F8a: alle eingereichten Anträge, unabhängig vom Betrachter — für die Zeile in `finance.todo`. */
function pendingExpenseClaimsCount(deps: Parameters<DashboardTile['load']>[0]): number {
  return deps.db.select({ id: financeExpenseClaims.id }).from(financeExpenseClaims).where(eq(financeExpenseClaims.state, 'submitted')).all().length;
}

/** F7 (Annahme 6): alle eingereichten Zahlungen an Partner, unabhängig vom Betrachter — für die Zeile in `finance.todo`. */
function pendingPartnerPaymentsCount(deps: Parameters<DashboardTile['load']>[0]): number {
  return deps.db.select({ id: financePartnerPayments.id }).from(financePartnerPayments).where(eq(financePartnerPayments.state, 'submitted')).all().length;
}

/** F7 (Annahme 13): freigegebene Zahlungen an Partner, deren Nachweise noch nicht anerkannt sind — mit Summe und Zahl der überfälligen. */
function partnerPaymentsWithoutProofInternal(deps: Parameters<DashboardTile['load']>[0], today: string): { count: number; sumCents: number; overdueCount: number } {
  const graceDays = readSetting<number>(deps, 'finance.proofGraceDays');
  // Task 6c: jede freigegebene, noch nicht anerkannte Zahlung zählt — auch die, deren Frist mangels Zahlung noch nicht läuft.
  const open = openProofsInternal(deps.db, today, graceDays);
  const sumCents = open.reduce((s, d) => s + sumPositionCents(positionViewsOf(deps.db, d.paymentId)), 0);
  return { count: open.length, sumCents, overdueCount: open.filter((d) => d.overdue).length };
}

/**
 * Befund 19: Bank- und Zahlungsdienstkonten, die nach dem festgeschriebenen
 * Buchbestand negativ stünden — keine Sperre (Dispo ist möglich, meist fehlt
 * ein Auszug), nur ein Hinweis. Die Kasse hat ihre eigene, härtere Sperre
 * (`firstNegativeCashDay`) und zählt hier nicht mit.
 */
function negativeAccountBalancesInternal(deps: Parameters<DashboardTile['load']>[0], today: string): { account: FinanceAccountRow; balanceCents: number }[] {
  const accounts = new Map(deps.db.select().from(financeAccounts).where(eq(financeAccounts.isActive, true)).all().map((a) => [a.id, a] as const));
  return accountBalancesAt(deps.db, today)
    .filter((b) => b.balanceCents < 0 && b.kind !== 'cash' && accounts.has(b.accountId))
    .map((b) => ({ account: accounts.get(b.accountId)!, balanceCents: b.balanceCents }));
}

const todoTile: DashboardTile<Record<string, never>> = {
  key: 'todo',
  permission: 'finance.read',
  kind: 'list',
  defaultOn: true,
  options: z.object({}),
  messageKeys: [
    'reviewedNotFinal', 'withoutVoucher', 'overdueItems', 'rawOpen', 'foreignMoney', 'vouchersWithoutEntry', 'lastStatement', 'noticeExpiring', 'noNotice', 'confirmationsToCorrect',
    'confirmationsNeedSignature', 'expenseClaimsPending', 'negativeBalance', 'partnerPaymentsPending', 'partnerPaymentsWithoutProof', 'partnerPaymentsOverdue', 'purposeTransfersPending', 'evidenceReadyToAcknowledge',
  ],
  async load(deps, ctx) {
    const today = todayIn(deps);
    const lines: DashboardLine[] = [];

    // Geprüft, aber noch nicht festgeschrieben — keine Namen, nur Zählung; das Datum ist die
    // älteste betroffene Buchung (eigene Spalte der Kachel, nicht im Satz selbst).
    const reviewedRes = await listEntries(deps, ctx, { state: 'reviewed', limit: 200 });
    if (reviewedRes.ok && reviewedRes.value.total > 0) {
      const oldest = reviewedRes.value.entries.reduce((min, e) => (e.reviewedAt && (!min || e.reviewedAt < min) ? e.reviewedAt : min), null as string | null);
      lines.push({ date: (oldest ?? today).slice(0, 10), titleKey: 'reviewedNotFinal', values: { count: reviewedRes.value.total }, href: '/finance/entries?state=reviewed' });
    }

    // Festgeschriebene Buchungen ohne Beleg.
    const withoutVoucherRes = await listEntries(deps, ctx, { state: 'final', withoutVoucher: true, limit: 1 });
    if (withoutVoucherRes.ok && withoutVoucherRes.value.total > 0) {
      lines.push({ titleKey: 'withoutVoucher', values: { count: withoutVoucherRes.value.total }, href: '/finance/entries?novoucher=1' });
    }

    // Überfällige offene Zahlungen — hier nur „Wir zahlen noch“ (payable): die Vereinspflicht, die zählt
    // als „zu tun“. Überfällige Forderungen (receivable) zeigt die eigene Kachel `finance.overdueItems`.
    const overdue = overdueOpenItemsInternal(deps.db, today, 'payable');
    if (overdue.length > 0) {
      const sumCents = overdue.reduce((s, i) => s + i.openCents, 0);
      lines.push({ titleKey: 'overdueItems', values: { count: overdue.length, sum: formatEuro(sumCents) }, href: '/finance/open-items?tab=payable' });
    }

    // F4 Task 6: Kontoumsätze ohne Zuordnung — ohne Namen, nur die Zahl. Seit F5 in die Arbeitsliste.
    const openRaw = countOpenRawTransactionsInternal(deps.db);
    if (openRaw > 0) lines.push({ titleKey: 'rawOpen', values: { count: openRaw }, href: '/finance/work' });

    // F5: Geld, das nicht dem Verein gehört und noch nicht weitergegeben ist — nur die Zahl, nie „für wen“.
    const foreign = await listForeignMoney(deps, ctx);
    if (foreign.ok && foreign.value.items.length > 0) lines.push({ titleKey: 'foreignMoney', values: { count: foreign.value.items.length }, href: '/finance/work/foreign' });

    // F5: Finanzbelege der Akte ohne Buchung — was der Aufrufer in der Akte nicht lesen darf, zählt die Akte nicht mit.
    const vouchers = await listVouchersWithoutEntry(deps, ctx, { limit: 1 });
    if (vouchers.ok && vouchers.value.total > 0) lines.push({ titleKey: 'vouchersWithoutEntry', values: { count: vouchers.value.total }, href: '/finance/work/vouchers' });

    // F4 Task 6: der älteste noch ausstehende Auszug — nur ein Konto, das schon einmal importiert
    // hat, kennt ein „vor N Tagen“; ein Konto ohne jeden Import zeigt die Checkliste, nicht diese Zeile.
    const warnDays = readSetting<number>(deps, 'finance.lastStatementWarnDays');
    const daysSinceOldestStatement = activeReconcilableAccounts(deps).reduce<number | null>((max, a) => {
      const through = importedThroughInternal(deps.db, a.id);
      if (through === null) return max;
      const days = daysBetween(today, through);
      return max === null || days > max ? days : max;
    }, null);
    if (daysSinceOldestStatement !== null && daysSinceOldestStatement >= warnDays) {
      lines.push({ titleKey: 'lastStatement', values: { days: daysSinceOldestStatement }, href: '/finance/imports' });
    }

    // F6a (Spec 9.7): der Bescheid läuft ab — ab `finance.noticeExpiryWarnMonths` vorher; die Art als Schlüssel, der Satz sagt sie in Alltagssprache.
    const expiry = noticeExpiryInternal(deps.db, today, readSetting<number>(deps, 'finance.noticeExpiryWarnMonths'));
    if (expiry) {
      const kind = noticeValidAtInternal(deps.db, today)!.kind;
      lines.push({ date: expiry.validUntil, titleKey: 'noticeExpiring', values: { kind, months: expiry.monthsLeft }, href: '/finance/donations/notices' });
    }
    // Kein Bescheid — erst eine Meldung, wenn es etwas zu bestätigen gäbe.
    if (!noticeValidAtInternal(deps.db, today) && certifiableLineExistsInternal(deps.db)) {
      lines.push({ titleKey: 'noNotice', values: {}, href: '/finance/donations/notices' });
    }

    // F6a Task 5 (Spec 9.7): Bestätigungen zu korrigieren (berechnet) und ohne Unterschrift — nur Zahlen, nie Namen.
    const toCorrect = countToCorrectInternal(deps.db);
    if (toCorrect > 0) lines.push({ titleKey: 'confirmationsToCorrect', values: { count: toCorrect }, href: '/finance/donations?tab=toCorrect' });
    const needsSignature = countNeedsSignatureInternal(deps.db);
    if (needsSignature > 0) lines.push({ titleKey: 'confirmationsNeedSignature', values: { count: needsSignature }, href: '/finance/donations?tab=needsSignature' });

    // F8a (Spec 9.7): wie viele Anträge insgesamt auf Freigabe warten — für jede und jeden mit finance.read,
    // ohne Betrag oder Namen; die eigene Warteschlange (ohne die eigenen Anträge) zeigt die Kachel `approvalsPending`.
    const pendingClaims = pendingExpenseClaimsCount(deps);
    if (pendingClaims > 0) lines.push({ titleKey: 'expenseClaimsPending', values: { count: pendingClaims }, href: '/finance/approvals' });

    // F7 (Annahme 6, 13): eingereichte Zahlungen an Partner, dazu freigegebene ohne anerkannten Nachweis (mit Summe) und überfällige.
    const pendingPayments = pendingPartnerPaymentsCount(deps);
    if (pendingPayments > 0) lines.push({ titleKey: 'partnerPaymentsPending', values: { count: pendingPayments }, href: '/finance/approvals' });

    // F8b Annahme 12: eingereichte Umwidmungen, die auf Freigabe warten.
    const pendingTransfers = deps.db.select({ id: financePurposeTransfers.id }).from(financePurposeTransfers).where(eq(financePurposeTransfers.state, 'submitted')).all().length;
    if (pendingTransfers > 0) lines.push({ titleKey: 'purposeTransfersPending', values: { count: pendingTransfers }, href: '/finance/approvals' });
    // U (Prüfer Block 2): für Freigebende — Nachweise fremder Zahlungen, die vollständig bereitliegen.
    if (hasPermission(ctx, 'finance.approve')) {
      const ready = paymentsReadyToAcknowledgeInternal(deps.db, ctx.userId ?? null);
      const only = ready.length === 1 ? ready[0]! : null;
      if (ready.length > 0) lines.push({ titleKey: 'evidenceReadyToAcknowledge', values: { count: ready.length }, href: only ? `/finance/partners/${only.partnerId}/payments/${only.id}` : '/finance/partners' });
    }
    const withoutProof = partnerPaymentsWithoutProofInternal(deps, today);
    if (withoutProof.count > 0) lines.push({ titleKey: 'partnerPaymentsWithoutProof', values: { count: withoutProof.count, sum: formatEuro(withoutProof.sumCents) }, href: '/finance/partners' });
    if (withoutProof.overdueCount > 0) lines.push({ titleKey: 'partnerPaymentsOverdue', values: { count: withoutProof.overdueCount }, href: '/finance/partners' });

    // Befund 19: Bank- oder Zahlungsdienstkonto stünde negativ — je Konto eine Zeile mit Namen und Betrag.
    for (const { account, balanceCents } of negativeAccountBalancesInternal(deps, today)) {
      lines.push({ titleKey: 'negativeBalance', values: { account: account.name, amount: formatEuro(balanceCents) }, href: '/finance/accounts' });
    }

    return { kind: 'list', lines, total: lines.length, href: '/finance/entries' };
  },
};

const withoutVoucherTile: DashboardTile<Record<string, never>> = {
  key: 'withoutVoucher',
  permission: 'finance.read',
  kind: 'count',
  defaultOn: false,
  options: z.object({}),
  async load(deps, ctx) {
    const res = await listEntries(deps, ctx, { state: 'final', withoutVoucher: true, limit: 1 });
    return { kind: 'count', count: res.ok ? res.value.total : 0, href: '/finance/entries?novoucher=1' };
  },
};

const staleDraftsTile: DashboardTile<Record<string, never>> = {
  key: 'staleDrafts',
  permission: 'finance.read',
  kind: 'count',
  defaultOn: false,
  options: z.object({}),
  load(deps) {
    // Voller Zeitstempel, nicht nur das Datum: `created_at` trägt eine Uhrzeit,
    // ein reiner Datums-Cutoff verglich sonst „2026-09-05“ (Cutoff) gegen
    // „2026-09-05T08:00:00.000Z“ (Zeile) und hielte die Zeile fälschlich für jünger.
    const cutoff = new Date(deps.clock.now().getTime() - STALE_DRAFT_DAYS * 86_400_000).toISOString();
    const rows = deps.db
      .select({ id: financeEntries.id })
      .from(financeEntries)
      .where(and(eq(financeEntries.status, 'draft'), isNull(financeEntries.reversedByEntryId), lt(financeEntries.createdAt, cutoff)))
      .all();
    return { kind: 'count', count: rows.length, href: '/finance/entries?state=draft' };
  },
};

const overdueItemsTile: DashboardTile<Record<string, never>> = {
  key: 'overdueItems',
  permission: 'finance.overview',
  kind: 'count',
  defaultOn: false,
  options: z.object({}),
  load(deps) {
    const today = todayIn(deps);
    const overdue = overdueOpenItemsInternal(deps.db, today);
    return { kind: 'count', count: overdue.length, href: '/finance/open-items' };
  },
};

// F8b Annahme 12, Design-Nachtrag Phase 4 (Entscheidung 8): mit „Finanzen lesen“ je Zweck eine Zeile, sonst Anzahl und Summe — standardmäßig an.
const purposesNegativeTile: DashboardTile<Record<string, never>> = {
  key: 'purposesNegative',
  permission: 'finance.overview',
  kind: 'list',
  defaultOn: true,
  options: z.object({}),
  messageKeys: ['ok', 'negative', 'line'],
  load(deps, ctx) {
    const today = todayIn(deps);
    const negative = purposeBalancesAt(deps.db, today).filter((p) => p.balanceCents < 0);
    if (!hasPermission(ctx, 'finance.read')) {
      if (negative.length === 0) return { kind: 'status', tone: 'neutral', messageKey: 'ok', href: '/finance/purposes' };
      const sumCents = negative.reduce((sum, p) => sum + p.balanceCents, 0);
      return { kind: 'status', tone: 'warning', messageKey: 'negative', values: { count: negative.length, sum: formatEuro(sumCents) }, href: '/finance/purposes' };
    }
    const names = new Map(deps.db.select({ id: financePurposes.id, name: financePurposes.name }).from(financePurposes).all().map((p) => [p.id, p.name] as const));
    const lines: DashboardLine[] = [...negative].sort((a, b) => a.balanceCents - b.balanceCents).map((p) => ({ titleKey: 'line', values: { name: names.get(p.purposeId) ?? '', amount: formatEuro(p.balanceCents) }, href: '/finance/purposes' }));
    return { kind: 'list', lines, total: lines.length, href: '/finance/purposes' };
  },
};

/**
 * F8b Annahme 12: der Höchstbetrag der freien Rücklage nähert sich — ab `warnAtPercent`, wie `LimitProgress` es auch
 * am Bildschirm zeigt. Befund 4/7c (0.2.7): geprüft werden dieselben Jahre wie auf der Seite (`freeReserveYears`:
 * offenes Vorjahr und laufendes Jahr); gemeldet wird das ernstere (überschritten vor nähert sich vor ruhig), bei
 * Gleichstand das jüngere. Ein Jahr ohne Höchstbetrag (0 €) zählt nicht — `limitState` kennt dort keinen Zustand.
 */
const reserveCapNearTile: DashboardTile<Record<string, never>> = {
  key: 'reserveCapNear',
  permission: 'finance.overview',
  kind: 'status',
  defaultOn: false,
  options: z.object({}),
  messageKeys: ['ok', 'near'],
  async load(deps, ctx) {
    const today = todayIn(deps);
    const overview = await freeReserveCapOverview(deps, ctx, {});
    const warnAtPercent = (valueAt(deps.db, 'warnAtPercent', today) as number | null) ?? 80;
    // 2 überschritten, 1 nähert sich, 0 ruhig — wie `limitState`. Die Jahre kommen älteres zuerst, `>=` nimmt bei Gleichstand das jüngere.
    let worst: { rank: number; percent: number } | null = null;
    for (const y of overview.ok ? overview.value.years : []) {
      if (y.capCents <= 0) continue;
      const rank = y.usedCents > y.capCents ? 2 : y.usedCents * 100 >= y.capCents * warnAtPercent ? 1 : 0;
      if (worst === null || rank >= worst.rank) worst = { rank, percent: Math.round((y.usedCents / y.capCents) * 100) };
    }
    if (!worst || worst.rank === 0) return { kind: 'status', tone: 'neutral', messageKey: 'ok', href: '/finance/reserves' };
    return { kind: 'status', tone: 'warning', messageKey: 'near', values: { percent: worst.percent }, href: '/finance/reserves' };
  },
};

/** Befund 19: nur die Zahl, ohne Kontoname oder Betrag — wie `purposesNegative`. */
const accountsNegativeTile: DashboardTile<Record<string, never>> = {
  key: 'accountsNegative',
  permission: 'finance.overview',
  kind: 'count',
  defaultOn: false,
  options: z.object({}),
  load(deps) {
    const today = todayIn(deps);
    return { kind: 'count', count: negativeAccountBalancesInternal(deps, today).length, href: '/finance/accounts' };
  },
};

const setupIncompleteTile: DashboardTile<Record<string, never>> = {
  key: 'setupIncomplete',
  permission: 'finance.setup',
  kind: 'status',
  defaultOn: true,
  options: z.object({}),
  messageKeys: ['incomplete', 'complete'],
  async load(deps, ctx) {
    const res = await getSetupStatus(deps, ctx);
    // F4 Task 6: ein offener optionaler Schritt (`importFormat`) zaehlt hier nicht mit.
    const open = res.ok ? res.value.steps.filter((s) => s.required && !s.done).length : 0;
    if (open === 0) return { kind: 'status', tone: 'neutral', messageKey: 'complete', href: '/admin/finance?panel=checklist' };
    return { kind: 'status', tone: 'warning', messageKey: 'incomplete', values: { count: open }, href: '/admin/finance?panel=checklist' };
  },
};

/** F4 Task 6, Spec 9.7 „Umsätze ohne Zuordnung“. */
const rawOpenTile: DashboardTile<Record<string, never>> = {
  key: 'rawOpen',
  permission: 'finance.read',
  kind: 'count',
  defaultOn: false,
  options: z.object({}),
  load(deps) {
    return { kind: 'count', count: countOpenRawTransactionsInternal(deps.db), href: '/finance/imports' };
  },
};

/** F4 Task 6, Spec 9.7 „Saldodifferenz“ — warnt, sobald ein Konto vom Auszug abweicht. */
const balanceDifferenceTile: DashboardTile<Record<string, never>> = {
  key: 'balanceDifference',
  permission: 'finance.read',
  kind: 'status',
  defaultOn: false,
  options: z.object({}),
  messageKeys: ['ok', 'differs'],
  load(deps) {
    const today = todayIn(deps);
    const differing = activeReconcilableAccounts(deps).filter((a) => reconcileBankInternal(deps.db, a.id, today).state === 'differs');
    if (differing.length === 0) return { kind: 'status', tone: 'neutral', messageKey: 'ok', href: '/finance/imports' };
    return { kind: 'status', tone: 'warning', messageKey: 'differs', values: { count: differing.length }, href: '/finance/imports' };
  },
};

/** F4 Task 6, Spec 9.7 „letzter Auszug“ — warnt ab `finance.lastStatementWarnDays`, auch für ein Konto ohne jeden Import. */
const lastStatementTile: DashboardTile<Record<string, never>> = {
  key: 'lastStatement',
  permission: 'finance.read',
  kind: 'status',
  defaultOn: false,
  options: z.object({}),
  messageKeys: ['ok', 'stale'],
  load(deps) {
    const today = todayIn(deps);
    const warnDays = readSetting<number>(deps, 'finance.lastStatementWarnDays');
    const stale = activeReconcilableAccounts(deps).filter((a) => {
      const through = importedThroughInternal(deps.db, a.id);
      return through === null || daysBetween(today, through) >= warnDays;
    });
    if (stale.length === 0) return { kind: 'status', tone: 'neutral', messageKey: 'ok', href: '/finance/imports' };
    return { kind: 'status', tone: 'warning', messageKey: 'stale', values: { count: stale.length }, href: '/finance/imports' };
  },
};

/** F6a Task 5, Spec 9.7 „Bestätigungen zu korrigieren“ — berechnet, nie gespeichert. */
const confirmationsToCorrectTile: DashboardTile<Record<string, never>> = {
  key: 'confirmationsToCorrect',
  permission: 'finance.read',
  kind: 'count',
  defaultOn: false,
  options: z.object({}),
  load(deps) {
    return { kind: 'count', count: countToCorrectInternal(deps.db), href: '/finance/donations?tab=toCorrect' };
  },
};

/** F8a (Spec 9.7): die Warteschlange des Betrachters — ohne seine eigenen Anträge. Vorgabe an, wie `todo`. */
const approvalsPendingTile: DashboardTile<Record<string, never>> = {
  key: 'approvalsPending',
  permission: 'finance.approve',
  kind: 'count',
  defaultOn: true,
  options: z.object({}),
  async load(deps, ctx) {
    const res = await listApprovals(deps, ctx, { limit: 1 });
    return { kind: 'count', count: res.ok ? res.value.total : 0, href: '/finance/approvals' };
  },
};

/** F8a (Spec 9.7): die eigenen offenen Anträge mit Zustand — nie Beträge anderer, weil nur die eigenen erscheinen. */
const myExpensesTile: DashboardTile<Record<string, never>> = {
  key: 'myExpenses',
  permission: 'finance.expensesSubmit',
  kind: 'list',
  defaultOn: true,
  options: z.object({}),
  messageKeys: ['draft', 'submitted', 'approved', 'paid', 'rejected'],
  async load(deps, ctx) {
    const res = await listMyExpenseClaims(deps, ctx, { state: 'open', limit: 10 });
    if (!res.ok) return { kind: 'list', lines: [], total: 0, href: '/finance/expenses' };
    const lines: DashboardLine[] = res.value.items.map((c) => ({ titleKey: c.stateLabelKey, values: { number: c.number ?? '—', amount: formatEuro(c.totalCents) }, href: `/finance/expenses/${c.id}` }));
    return { kind: 'list', lines, total: res.value.total, href: '/finance/expenses' };
  },
};

/** F8a (Spec 9.7): warnt, solange kein aktiver Nutzer `finance.approve` trägt — sonst bleibt jeder Antrag stecken. */
const nobodyCanApproveTile: DashboardTile<Record<string, never>> = {
  key: 'nobodyCanApprove',
  permission: 'finance.setup',
  kind: 'status',
  defaultOn: true,
  options: z.object({}),
  messageKeys: ['ok', 'nobody'],
  load(deps) {
    const approvers = listUserNamesWithPermission(deps, 'finance.approve');
    if (approvers.length === 0) return { kind: 'status', tone: 'warning', messageKey: 'nobody', href: '/admin/roles' };
    return { kind: 'status', tone: 'neutral', messageKey: 'ok', href: '/admin/roles' };
  },
};

/**
 * F7 (Annahme 13), Design-Nachtrag Phase 4 (Entscheidung 8, Artboard 4g):
 * Zahlungen an Partner, freigegeben, deren Nachweise noch nicht anerkannt
 * sind. Mit „Finanzen lesen“ je Zahlung eine Zeile — Partner, Nummer, Betrag,
 * „seit N Tagen überfällig“ oder „offen“ mit Frist; ohne nur Anzahl, Summe und
 * die überfälligen, nie Namen. Standardmäßig an. Abweichung vom Design:
 * „Zahlungen an Partner ohne Nachweis“ statt „Partnerzahlungen ohne
 * Nachweis“ — das Wörterbuch verbietet „Partnerzahlung“.
 */
const partnerPaymentsWithoutProofTile: DashboardTile<Record<string, never>> = {
  key: 'partnerPaymentsWithoutProof',
  permission: 'finance.overview',
  kind: 'list',
  defaultOn: true,
  options: z.object({}),
  messageKeys: ['ok', 'open', 'lineOpen', 'lineOverdue'],
  load(deps, ctx) {
    const today = todayIn(deps);
    if (!hasPermission(ctx, 'finance.read')) {
      const { count, sumCents, overdueCount } = partnerPaymentsWithoutProofInternal(deps, today);
      if (count === 0) return { kind: 'status', tone: 'neutral', messageKey: 'ok', href: '/finance/partners' };
      return { kind: 'status', tone: overdueCount > 0 ? 'warning' : 'neutral', messageKey: 'open', values: { count, sum: formatEuro(sumCents), overdue: overdueCount }, href: '/finance/partners' };
    }
    const open = openProofsInternal(deps.db, today, readSetting<number>(deps, 'finance.proofGraceDays'));
    const lines: DashboardLine[] = open.map((p) => {
      const profile = deps.db.select({ contactId: financePartnerProfiles.contactId }).from(financePartnerProfiles).where(eq(financePartnerProfiles.id, p.partnerId)).get();
      const contact = profile ? deps.db.select().from(contacts).where(eq(contacts.id, profile.contactId)).get() : undefined;
      const values = { partner: contact ? displayName(contact) : '', number: p.number ?? '', amount: formatEuro(sumPositionCents(positionViewsOf(deps.db, p.paymentId))) };
      const href = `/finance/partners/${p.partnerId}/payments/${p.paymentId}`;
      return p.overdue
        ? { titleKey: 'lineOverdue', values: { ...values, days: p.overdueDays ?? 0 }, ...(p.proofDueOn ? { date: p.proofDueOn } : {}), overdue: true, href }
        : { titleKey: 'lineOpen', values, ...(p.proofDueOn ? { date: p.proofDueOn } : {}), href };
    });
    return { kind: 'list', lines, total: lines.length, href: '/finance/partners' };
  },
};

export const FINANCE_DASHBOARD_TILES: readonly DashboardTile[] = [
  todoTile as DashboardTile,
  withoutVoucherTile as DashboardTile,
  partnerPaymentsWithoutProofTile as DashboardTile,
  staleDraftsTile as DashboardTile,
  overdueItemsTile as DashboardTile,
  purposesNegativeTile as DashboardTile,
  reserveCapNearTile as DashboardTile,
  accountsNegativeTile as DashboardTile,
  setupIncompleteTile as DashboardTile,
  rawOpenTile as DashboardTile,
  balanceDifferenceTile as DashboardTile,
  lastStatementTile as DashboardTile,
  confirmationsToCorrectTile as DashboardTile,
  approvalsPendingTile as DashboardTile,
  myExpensesTile as DashboardTile,
  nobodyCanApproveTile as DashboardTile,
];
