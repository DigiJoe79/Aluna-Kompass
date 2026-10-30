import { localizedConflict, ok, requirePermission, validate, writeSettingInternal, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { z } from 'zod';

/** Tesseract-Kürzel, mit `+` verbunden — dieselbe Form wie die Einstellung `dms.ocrLanguages`. */
export const ocrLanguagesSchema = z.object({ languages: z.string().trim().regex(/^[a-z]{3}(\+[a-z]{3})*$/, 'invalidOcrLanguages') });

/**
 * Die Sprachen der Texterkennung (`dms.ocrLanguages`), nur solche, die Tesseract in dieser Umgebung kennt (Befundliste
 * 0.4.0, K1b): Eine fehlende Sprache ließe jede Texterkennung scheitern. Oberfläche und MCP rufen diesen Dienst; die
 * Einstellung selbst ist geführt (`managedBy: 'dms'`), `settings_set` lehnt sie ab. `settings.manage` wie bisher.
 */
export async function setOcrLanguages(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ languages: string }>> {
  const denied = requirePermission(ctx, 'settings.manage');
  if (denied) return denied;
  const parsed = validate(deps, ocrLanguagesSchema, input);
  if (!parsed.ok) return parsed;
  const probe = await deps.textExtraction.probe();
  if (!probe.ok) return localizedConflict('ocrUnavailable', 'dms.errors.ocrUnavailable');
  const list = parsed.value.languages.split('+');
  const missing = list.find((lang) => !probe.languages.includes(lang));
  if (missing) return localizedConflict('ocrLanguageMissing', 'dms.errors.ocrLanguageMissing', { lang: missing });
  const languages = list.join('+');
  return deps.db.transaction((tx: DbOrTx) => {
    const written = writeSettingInternal(tx, deps, ctx, 'dms.ocrLanguages', languages);
    return written.ok ? ok({ languages }) : written;
  });
}
