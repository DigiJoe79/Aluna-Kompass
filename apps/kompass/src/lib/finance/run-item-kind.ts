/**
 * Befund 21: Der Serienlauf stellt bei genau einer Zeile eine Einzelbestätigung aus, erst ab zwei die Sammelbestätigung
 * (`issueKindOf` im Finanzmodul). Die Beschriftung folgt dem, was ausgestellt wird — Schlüssel unter `itemKind`.
 */
export function runItemKindKey(kind: 'collective' | 'collectiveWaiver' | 'inKind', lineCount: number): 'collective' | 'collectiveWaiver' | 'inKind' | 'single' | 'singleWaiver' {
  if (kind === 'inKind' || lineCount > 1) return kind;
  return kind === 'collectiveWaiver' ? 'singleWaiver' : 'single';
}
