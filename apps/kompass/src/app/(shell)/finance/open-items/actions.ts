'use server';

import { cancelOpenItem, saveOpenItem } from '@kompass/module-finance';
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
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await saveOpenItem(deps, ctx, input);
  revalidatePath('/finance/open-items');
  if (!result.ok) return toActionState(result, t);
  return toActionState(result, t, t(input.id ? 'finance.openItems.dialog.toast.updated' : 'finance.openItems.dialog.toast.created'));
}

export async function cancelOpenItemAction(id: string, note: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await cancelOpenItem(deps, ctx, { id, note });
  revalidatePath('/finance/open-items');
  if (!result.ok) return toActionState(result, t);
  return toActionState(result, t, t('finance.openItems.settleWithoutPayment.toast.done'));
}
