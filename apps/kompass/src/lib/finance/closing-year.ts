/**
 * Vorgabe des Jahres im Jahresabschluss (Plan C2, Claude): das jüngste beendete Jahr, dessen Abschluss nicht „Fertig.“
 * ist; sonst das jüngste beendete; sonst das laufende (das jüngste überhaupt). `finished` fragt den Stand eines Jahres
 * erst, wenn er gebraucht wird — von oben nach unten, bis eines nicht fertig ist.
 */
export async function defaultClosingYearId(
  years: readonly { id: string; endsOn: string }[],
  today: string,
  finished: (yearId: string) => Promise<boolean>,
): Promise<string | null> {
  const newestFirst = [...years].sort((a, b) => b.endsOn.localeCompare(a.endsOn));
  const ended = newestFirst.filter((y) => y.endsOn < today);
  for (const year of ended) if (!(await finished(year.id))) return year.id;
  return ended[0]?.id ?? newestFirst[0]?.id ?? null;
}
