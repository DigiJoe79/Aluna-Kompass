import { type CallContext, type Deps, type Result, ok, readSetting, requirePermission, validate, writeSettingInternal } from '@kompass/core';
import { z } from 'zod';

/**
 * Die Begriffe, die nie auf der Webseite erscheinen dürfen; ein Treffer sperrt
 * den Publish (`export.ts`). Gespeichert als Einstellung `site.blockedTerms`,
 * gepflegt von dem, der publiziert — die Liste ist die Schranke vor seinem
 * Knopf (Backlog 23).
 */
export const blockedTermsSchema = z.object({ terms: z.array(z.string()) });

export async function getBlockedTerms(deps: Deps, ctx: CallContext): Promise<Result<string[]>> {
  const denied = requirePermission(ctx, 'site.view');
  if (denied) return denied;
  return ok(readSetting<string[]>(deps, 'site.blockedTerms'));
}

/** Leere Zeilen fallen weg, Dubletten ohne Rücksicht auf Groß- und Kleinschreibung auch. */
function tidy(terms: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms) {
    const term = raw.trim();
    if (!term || seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    out.push(term);
  }
  return out;
}

export async function setBlockedTerms(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<string[]>> {
  const denied = requirePermission(ctx, 'site.publish');
  if (denied) return denied;
  const parsed = validate(deps, blockedTermsSchema, input);
  if (!parsed.ok) return parsed;
  const terms = tidy(parsed.value.terms);
  return deps.db.transaction((tx) => {
    const written = writeSettingInternal(tx, deps, ctx, 'site.blockedTerms', terms, 'site.blockedTerms.set');
    return written.ok ? ok(written.value.value as string[]) : written;
  });
}
