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
 * `FormData` statt eines Uint8Array-Feldes (N9) — sonst scheitert das Laden
 * ab rund 1 MB stumm; `format` reist als JSON-Feld mit.
 */
export async function saveCsvFormatAction(formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const accountId = String(formData.get('accountId') ?? '');
  const name = String(formData.get('name') ?? '');
  const format = JSON.parse(String(formData.get('format') ?? '{}')) as CsvFormat;
  const confirmFormatChange = formData.get('confirmFormatChange') === 'true';
  const saved = await saveImportProfile(deps, ctx, { accountId, name, format, confirmFormatChange });
  revalidatePath('/finance/imports');
  revalidatePath('/finance/accounts');
  const file = formData.get('file');
  if (!saved.ok || !(file instanceof File)) return toActionState(saved, t, t('finance.csvAssistant.toast.saved'));

  const closingBalanceCentsRaw = formData.get('closingBalanceCents');
  const closingBalanceCents = typeof closingBalanceCentsRaw === 'string' && closingBalanceCentsRaw !== '' ? Number(closingBalanceCentsRaw) : undefined;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const imported = await importStatement(deps, ctx, { accountId, fileName: file.name, bytes, closingBalanceCents });
  if (!imported.ok) return toActionState(imported, t);
  const counts = imported.value.runs.reduce((s, r) => ({ new: s.new + r.counts.new, known: s.known + r.counts.known, held: s.held + r.counts.held }), { new: 0, known: 0, held: 0 });
  return toActionState(imported, t, t('finance.csvAssistant.toast.savedAndLoaded', counts));
}
