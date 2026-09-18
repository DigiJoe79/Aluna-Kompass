/**
 * Gehoert das Sitzungscookie auf `secure`?
 *
 * Die Installation laeuft nach Zielbild im eigenen Netz ueber http, und dort
 * muss das Cookie offen bleiben: Ein `secure`-Cookie ueber http verwirft der
 * Browser, und dann meldet sich niemand mehr an. Sobald aber ein Reverse Proxy
 * mit TLS davorsteht — der wahrscheinlichste Weg, die Anwendung doch von
 * aussen erreichbar zu machen —, darf es nicht mehr ueber Klartext mitgehen.
 *
 * Entschieden wird das an `x-forwarded-proto`. Wer den Header faelschen kann,
 * sitzt ohnehin zwischen Proxy und Anwendung; und die Vorgabe ohne Header
 * bleibt das bisherige Verhalten.
 */
export function cookieShouldBeSecure(forwardedProto: string | null): boolean {
  const ersterSprung = forwardedProto?.split(',')[0]?.trim().toLowerCase();
  return ersterSprung === 'https';
}
