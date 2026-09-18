/**
 * Ein mailto-Link nach RFC 6068: Betreff und Text prozentkodiert.
 *
 * Nicht `URLSearchParams` — das schreibt Leerzeichen als „+“, und ein
 * Mailprogramm zeigt das wörtlich an („Frage+zur+Mitgliedschaft“).
 * `encodeURIComponent` schreibt %20, Zeilenumbrüche werden zu %0A.
 */
export function mailtoHref(email: string, opts: { subject?: string; body?: string } = {}): string {
  const parts: string[] = [];
  if (opts.subject) parts.push(`subject=${encodeURIComponent(opts.subject)}`);
  if (opts.body) parts.push(`body=${encodeURIComponent(opts.body)}`);
  return parts.length > 0 ? `mailto:${email}?${parts.join('&')}` : `mailto:${email}`;
}
