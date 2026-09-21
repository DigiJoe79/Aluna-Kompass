'use server';

import { countCash, emptyDonationBox, moveCash } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export interface CountCashInput {
  accountId: string;
  countedOn: string;
  countedCents: number;
  counterOneContactId: string;
  counterTwoContactId: string;
  note?: string;
  denominations?: Record<string, number>;
}

export async function countCashAction(input: CountCashInput): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await countCash(deps, ctx, input);
  revalidatePath('/finance/cash');
  revalidatePath('/finance/entries');
  if (!result.ok) return toActionState(result, t);
  return toActionState(result, t, t('finance.cash.count.toast.done', { number: result.value.documentNumber }));
}

export interface EmptyDonationBoxInput {
  accountId: string;
  date: string;
  amountCents: number;
  counterOneContactId: string;
  counterTwoContactId: string;
  categoryId?: string;
  boxLabel: string;
}

export async function emptyDonationBoxAction(input: EmptyDonationBoxInput): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await emptyDonationBox(deps, ctx, input);
  revalidatePath('/finance/cash');
  revalidatePath('/finance/entries');
  if (!result.ok) return toActionState(result, t);
  return toActionState(result, t, t('finance.cash.count.toast.done', { number: result.value.documentNumber }));
}

export interface MoveCashInput {
  fromAccountId: string;
  toAccountId: string;
  date: string;
  amountCents: number;
  text?: string;
}

export async function moveCashAction(input: MoveCashInput): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await moveCash(deps, ctx, input);
  revalidatePath('/finance/cash');
  revalidatePath('/finance/entries');
  if (!result.ok) return toActionState(result, t);
  return toActionState(result, t, t('finance.cash.move.toast.done'));
}
