'use server';

import { decideCandidate, detectStatementAccount, discardRun, importStatement, previewDiscardRun, setRunClosingBalance, type DiscardPreview } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

function revalidateImports(): void {
  revalidatePath('/finance/imports');
  revalidatePath('/finance/accounts');
}

/** Erkennt das Konto eines Auszugs (N3, W-1) — liest nur, legt keinen Lauf an; `data` ist ein `DetectedStatement`. */
export async function detectStatementAccountAction(fileName: string, bytes: Uint8Array): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  return toActionState(await detectStatementAccount(deps, ctx, { fileName, bytes }), t);
}

/** Lädt einen Kontoauszug (F4 Task 7) — `finance.entriesWrite`, ein Aufruf je Datei; mehrere Dateien laufen nacheinander in der Oberfläche, nicht hier. */
export async function uploadStatementAction(accountId: string, fileName: string, bytes: Uint8Array, confirmFormatChange?: boolean): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await importStatement(deps, ctx, { accountId, fileName, bytes, confirmFormatChange });
  revalidateImports();
  if (!result.ok) return toActionState(result, t);
  return toActionState(result, t, undefined);
}

export async function decideCandidateAction(id: string, decision: 'same' | 'own'): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await decideCandidate(deps, ctx, { id, decision });
  revalidateImports();
  return toActionState(result, t);
}

/** Wie `loadPreview` bei `DeleteRecordDialog`: `null` bei Ablehnung (etwa fehlendes Recht), sonst die Vorschau. */
export async function previewDiscardRunAction(id: string): Promise<DiscardPreview | null> {
  const { deps, ctx } = await requireSession();
  const result = await previewDiscardRun(deps, ctx, { id });
  return result.ok ? result.value : null;
}

export async function discardRunAction(id: string, note: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await discardRun(deps, ctx, { id, note });
  revalidateImports();
  return toActionState(result, t, t('finance.imports.discard.toast.done'));
}

/** „Kontostand nachtragen“ (N2) — einmalig, an einem fertigen, nicht verworfenen Auszug ohne Kontostand. */
export async function setRunClosingBalanceAction(runId: string, closingBalanceCents: number): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await setRunClosingBalance(deps, ctx, { runId, closingBalanceCents });
  revalidateImports();
  return toActionState(result, t, t('finance.imports.amendBalance.toast.done'));
}
