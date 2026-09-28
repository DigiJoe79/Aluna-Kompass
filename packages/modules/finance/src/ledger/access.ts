import { forbidden, hasPermission, type CallContext, type Failure } from '@kompass/core';

/**
 * `finance.overview` sieht Stände und Berichte ohne Personenbezug, `finance.read`
 * alles mit Namen. Wer `read` hat, darf auch alles, was `overview` darf.
 * Jeder lesende Dienst sagt hier, welche Stufe er braucht — und was er für
 * `overview` weglässt (IBAN, Kontakt, Freitext).
 */
export function requireFinanceRead(ctx: CallContext, level: 'overview' | 'read'): Failure | null {
  if (hasPermission(ctx, 'finance.read')) return null;
  if (level === 'overview' && hasPermission(ctx, 'finance.overview')) return null;
  return forbidden(level === 'read' ? 'finance.read' : 'finance.overview');
}

/**
 * Stammdaten (Konten, Kategorien, Zwecke, datierte Werte, Geschäftsjahre)
 * lesen: `read` und `setup` sehen alles, `overview` ohne Bankdaten
 * (Befundliste 0.2.0, N3 — wer pflegt, muss sehen, was er pflegt).
 */
export function requireMasterDataRead(ctx: CallContext): { failure: Failure | null; withBankDetails: boolean } {
  if (hasPermission(ctx, 'finance.read') || hasPermission(ctx, 'finance.setup')) return { failure: null, withBankDetails: true };
  if (hasPermission(ctx, 'finance.overview')) return { failure: null, withBankDetails: false };
  return { failure: forbidden('finance.overview'), withBankDetails: false };
}
