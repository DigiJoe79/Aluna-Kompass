'use server';

import { setProjectFinance } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export interface ProjectFinanceInput {
  projectId: string;
  targetCents: number | null;
  defaultPurposeId: string | null;
  abroad: boolean;
  publishDonationStatus: boolean;
}

export async function setProjectFinanceAction(input: ProjectFinanceInput): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await setProjectFinance(deps, ctx, input);
  revalidatePath(`/projects/${input.projectId}`);
  if (!result.ok) return toActionState(result, t);
  return toActionState(result, t, t('finance.projectSection.toast.saved'));
}
