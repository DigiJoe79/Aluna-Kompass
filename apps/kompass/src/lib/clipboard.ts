/**
 * `navigator.clipboard` gibt es nur in einem sicheren Kontext (HTTPS oder
 * `localhost`). Kompass läuft nach Zielbild im LAN über Klartext-HTTP (siehe
 * `secure-cookie.ts`) — dort ist `navigator.clipboard` schlicht `undefined`,
 * und ein ungeprüfter Aufruf wirft nur eine stille, unbehandelte Ausnahme.
 * `document.execCommand('copy')` ist zwar veraltet, funktioniert aber weiterhin
 * und braucht keinen sicheren Kontext.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Weiter zum Fallback.
    }
  }
  const el = document.createElement('textarea');
  el.value = text;
  el.style.position = 'fixed';
  el.style.opacity = '0';
  document.body.appendChild(el);
  el.focus();
  el.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(el);
  return ok;
}
