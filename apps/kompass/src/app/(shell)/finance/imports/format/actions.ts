'use server';

import { importStatement, saveImportProfile } from '@kompass/module-finance';
import type { CsvFormat } from '@kompass/module-finance/csv';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

/**
 * Speichert das CSV-Format (F4b Task 5) — `finance.setup` prüft der Dienst —
 * und lädt auf Wunsch gleich die Datei, mit der es eingerichtet wurde
 * (`finance.entriesWrite`). Das Format wird serverseitig noch einmal geprüft.
 */
export async function saveCsvFormatAction(input: {
  accountId: string;
  name: string;
  format: CsvFormat;
  confirmFormatChange: boolean;
  load: { fileName: string; bytes: Uint8Array; closingBalanceCents?: number } | null;
}): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const saved = await saveImportProfile(deps, ctx, { accountId: input.accountId, name: input.name, format: input.format, confirmFormatChange: input.confirmFormatChange });
  revalidatePath('/finance/imports');
  revalidatePath('/finance/accounts');
  if (!saved.ok || !input.load) return toActionState(saved, t, t('finance.csvAssistant.toast.saved'));

  const imported = await importStatement(deps, ctx, { accountId: input.accountId, fileName: input.load.fileName, bytes: input.load.bytes, closingBalanceCents: input.load.closingBalanceCents });
  if (!imported.ok) return toActionState(imported, t);
  const counts = imported.value.runs.reduce((s, r) => ({ new: s.new + r.counts.new, known: s.known + r.counts.known, held: s.held + r.counts.held }), { new: 0, known: 0, held: 0 });
  return toActionState(imported, t, t('finance.csvAssistant.toast.savedAndLoaded', counts));
}
