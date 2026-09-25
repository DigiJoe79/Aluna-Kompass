'use server';

import { dispatchRunConfirmations, previewConfirmationRun, startConfirmationRun } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

/**
 * Server Actions des Serienlaufs (F6b Task 7). Jede ruft genau einen Dienst
 * des Finanzmoduls; Auswahl, Prüfliste, Rechte und Protokoll stehen dort.
 * Fortgesetzt wird nicht hier, sondern über den Route Handler
 * `/finance/donations/run/[id]/continue` — Server Actions laufen seriell.
 */
export interface RunSelectionInput {
  year: number;
  minCents?: number;
  excludedContactIds?: string[];
  followUpOfRunId?: string;
}

function revalidate(): void {
  revalidatePath('/finance/donations');
  revalidatePath('/finance/donations/run');
  revalidatePath('/finance/entries');
}

/** Die Vorschau neu rechnen, wenn sich die Auswahl ändert — `finance.read`. */
export async function previewConfirmationRunAction(input: RunSelectionInput): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  return toActionState(await previewConfirmationRun(deps, ctx, input), t);
}

/** Den Lauf starten — `finance.donationsIssue`, nur ein Mensch. Ausgestellt wird danach über den Continue-Handler. */
export async function startConfirmationRunAction(input: RunSelectionInput & { preNoticeReason?: string }): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await startConfirmationRun(deps, ctx, input);
  revalidate();
  if (!result.ok) return toActionState(result, t);
  return { status: 'success', message: t('finance.donations.run.toast.started'), data: { id: result.value.id } };
}

/** Versandvermerk für alle maschinellen Bestätigungen des Laufs — ein Vermerk, kein Versand. */
export async function dispatchRunConfirmationsAction(input: { runId: string; sentAt: string; sentVia: 'post' | 'email' | 'handed' }): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await dispatchRunConfirmations(deps, ctx, input);
  revalidate();
  if (!result.ok) return toActionState(result, t);
  return { status: 'success', message: t('finance.donations.run.dispatch.toast') };
}
