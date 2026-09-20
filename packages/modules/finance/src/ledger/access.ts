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
