'use server';

import { guardAction } from '@/lib/action-guard';
import { assignPaymentToOpenItem, cancelOpenItem, financeConflict, getOpenItem, listAccounts, listAssignablePayments, listCategories, listOpenItemSettlements, saveOpenItem, unassignPaymentFromOpenItem, type AssignableCandidate } from '@kompass/module-finance';
import { displayName, getContact } from '@kompass/module-contacts';
import { panelHref } from '@/components/panel-nav';
import { formatEuro } from '@/lib/finance/amount';
import { unfoundedNoticesOf } from '@/lib/members/unfounded';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export interface SaveOpenItemInput {
  id?: string;
  expectedVersion?: string;
  kind: 'receivable' | 'payable';
  itemDate: string;
  contactId?: string | null;
  amountCents: number;
  dueOn?: string | null;
  documentId?: string | null;
  paymentReference?: string | null;
}

export async function saveOpenItemAction(input: SaveOpenItemInput): Promise<ActionState> {
  return guardAction('(shell)/finance/open-items/actions.ts#saveOpenItemAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await saveOpenItem(deps, ctx, input);
    revalidatePath('/finance/open-items');
    if (!result.ok) return toActionState(result, t);
    return toActionState(result, t, t(input.id ? 'finance.openItems.dialog.toast.updated' : 'finance.openItems.dialog.toast.created'));
  });
}

export async function cancelOpenItemAction(id: string, note: string): Promise<ActionState> {
  return guardAction('(shell)/finance/open-items/actions.ts#cancelOpenItemAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await cancelOpenItem(deps, ctx, { id, note });
    revalidatePath('/finance/open-items');
    if (!result.ok) return toActionState(result, t);
    return toActionState(result, t, t('finance.openItems.settleWithoutPayment.toast.done'));
  });
}

/** Eine Zeile im Dialog „Zahlung zuordnen“ (Spec Zahlung zuordnen § 3.5): der Kandidat mit Namen statt IDs. */
export interface AssignCandidateRow extends AssignableCandidate {
  categoryLabel: string;
  accountName: string;
  payerName: string;
  /** „60,00 € bei Beitrag 2026 · M-0013 (Lena Keller)“ — wohin der Rest der Zahlung schon ging (Design 2d). */
  assignedToLabels: string[];
  /** Der Satz der Sperre (Grund und Ausweg) mit seinem Link; `null` ohne Sperre. */
  blockedText: string | null;
  blockedLink: { href: string; kind: 'rebook' | 'reopen' } | null;
}

export interface AssignDialogData {
  item: { id: string; contactLabel: string | null; paymentReference: string | null; amountCents: number; openCents: number; dueOn: string | null; draftSettlementCents: number };
  candidates: AssignCandidateRow[];
}

/** Daten des Dialogs „Zahlung zuordnen“ für einen Posten: Kopf und Kandidaten (`finance.read`). */
export async function assignablePaymentsAction(openItemId: string): Promise<ActionState> {
  return guardAction('(shell)/finance/open-items/actions.ts#assignablePaymentsAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await listAssignablePayments(deps, ctx, { openItemId });
    if (!result.ok) return toActionState(result, t);
    const itemRes = await getOpenItem(deps, ctx, { id: openItemId });
    if (!itemRes.ok) return toActionState(itemRes, t);
    const view = itemRes.value;
    const names = new Map<string, string>();
    const nameOf = async (id: string | null) => {
      if (!id) return '';
      if (!names.has(id)) {
        const res = await getContact(deps, ctx, id);
        names.set(id, res.ok ? displayName(res.value) : '');
      }
      return names.get(id)!;
    };
    const categoryRes = await listCategories(deps, ctx, { includeInactive: true });
    const accountRes = await listAccounts(deps, ctx, { includeInactive: true });
    const categories = new Map((categoryRes.ok ? categoryRes.value : []).map((c) => [c.id, c.name]));
    const accounts = new Map((accountRes.ok ? accountRes.value : []).map((a) => [a.id, a.name]));
    const candidates: AssignCandidateRow[] = [];
    for (const c of result.value) {
      const blocked = c.blockedBy === null ? null : c.blockedBy === 'fiscalYearClosed' ? t('finance.openItems.assign.blocked.fiscalYearClosed', { year: String(c.blockedParams?.year ?? '') }) : toActionState(financeConflict(c.blockedBy as never, (c.blockedParams ?? {}) as never), t);
      const blockedText = blocked === null ? null : typeof blocked === 'string' ? blocked : blocked.status === 'error' ? blocked.message : null;
      const assignedToLabels: string[] = [];
      for (const a of c.assignedTo) assignedToLabels.push(t('finance.openItems.assign.assignedTo', { amount: formatEuro(a.amountCents), reference: a.paymentReference ?? '', name: (await nameOf(a.contactId)) || 'none' }));
      candidates.push({
        ...c,
        categoryLabel: c.categoryIds.map((id) => categories.get(id) ?? '').filter(Boolean).join(', '),
        accountName: accounts.get(c.accountId) ?? '',
        payerName: await nameOf(c.payerContactId),
        assignedToLabels,
        blockedText,
        blockedLink: c.blockedBy === 'fiscalYearClosed' ? { href: panelHref('/admin/finance', 'fiscalYears'), kind: 'reopen' } : c.blockedBy === 'assignCategoryMismatch' || c.blockedBy === 'assignCategoryNotTemplate' || c.blockedBy === 'assignContactMismatch' ? { href: `/finance/entries/${c.entryId}`, kind: 'rebook' } : null,
      });
    }
    const data: AssignDialogData = {
      item: { id: view.id, contactLabel: (await nameOf(view.contactId)) || null, paymentReference: view.paymentReference, amountCents: view.amountCents, openCents: view.openCents, dueOn: view.dueOn, draftSettlementCents: view.draftSettlementCents },
      candidates,
    };
    return { status: 'success', data };
  });
}

/** Eine gebuchte Zahlung dem Posten zuordnen (`finance.entriesWrite`). `unfoundedNotice`: Danach gibt es einen Hinweis auf eine unbegründete Mahnung (Spec § 3.4a). */
export async function assignPaymentAction(input: { openItemId: string; moneyLineId: string; amountCents?: number }): Promise<ActionState> {
  return guardAction('(shell)/finance/open-items/actions.ts#assignPaymentAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await assignPaymentToOpenItem(deps, ctx, input);
    revalidatePath('/finance/open-items');
    revalidatePath('/members', 'layout');
    if (!result.ok) return toActionState(result, t);
    const item = result.value;
    const charge = item.originType === 'memberFeeCharge' && item.originId ? item.originId : null;
    const unfoundedNotice = charge ? unfoundedNoticesOf(deps, charge).length > 0 : false;
    // Für „Rückgängig“: die eben entstandene Zuordnung — die jüngste aufhebbare des Postens.
    const settlements = await listOpenItemSettlements(deps, ctx, { openItemId: item.id });
    const settlementId = settlements.ok ? (settlements.value.filter((s) => s.unassignable).sort((a, b) => (b.assignedAt ?? '').localeCompare(a.assignedAt ?? ''))[0]?.settlementId ?? null) : null;
    return { status: 'success', data: { openItemId: item.id, unfoundedNotice, openCents: item.openCents, settlementId } };
  });
}

/** Eine nachträgliche Zuordnung aufheben (`finance.entriesWrite`). */
export async function unassignPaymentAction(settlementId: string): Promise<ActionState> {
  return guardAction('(shell)/finance/open-items/actions.ts#unassignPaymentAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await unassignPaymentFromOpenItem(deps, ctx, { settlementId });
    revalidatePath('/finance/open-items');
    revalidatePath('/members', 'layout');
    if (!result.ok) return toActionState(result, t);
    return { status: 'success', data: { openItemId: result.value.id } };
  });
}
