'use server';

import { saveFundsUseOpening } from '@kompass/module-finance';
import { revalidatePath } from 'next/cache';
import { guardAction } from '@/lib/action-guard';
import { actionState } from '@/lib/action-state';
import type { ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

/**
 * Anfangsvortrag der Mittelverwendung erfassen oder ändern (`finance.setup`, Plan U2 Task 3) — derselbe Dienst wie das
 * Werkzeug der Agenten. Der Beleg kommt aus der Akte (`documentId`) oder als PDF (`file`), nie beides; beim Ändern ohne
 * beides bleibt der vorhandene (Muster `reserves/actions.ts`, Vortrag).
 */
export async function saveFundsUseOpeningAction(formData: FormData): Promise<ActionState> {
  return guardAction('(shell)/finance/fund-use/actions.ts#saveFundsUseOpeningAction', async () => {
    const { deps, ctx } = await requireSession();
    const documentId = (formData.get('documentId') as string) || undefined;
    const file = formData.get('file');
    const upload = !documentId && file instanceof File && file.size > 0 ? { bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name } : undefined;
    const expectedVersion = (formData.get('expectedVersion') as string) || undefined;
    const result = await saveFundsUseOpening(deps, ctx, {
      offset: Number(formData.get('offset')),
      designation: String(formData.get('designation') ?? ''),
      endsOn: String(formData.get('endsOn') ?? ''),
      revenueCents: Number(formData.get('revenueCents')),
      amountCents: Number(formData.get('amountCents')),
      ...(expectedVersion ? { expectedVersion } : {}),
      ...(documentId ? { documentId } : {}),
      ...(upload ? { upload } : {}),
    });
    if (result.ok) revalidatePath('/finance/fund-use');
    return actionState(result);
  });
}
