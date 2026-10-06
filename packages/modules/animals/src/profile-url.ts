const SLUG = '{slug}';

/** Die Adresse eines Profils aus der Vorlage `animals.profileUrl`; `null` ohne Vorlage oder ohne Platzhalter. */
export function profileUrl(template: string, slug: string): string | null {
  if (!template.includes(SLUG)) return null;
  return template.split(SLUG).join(encodeURIComponent(slug));
}
