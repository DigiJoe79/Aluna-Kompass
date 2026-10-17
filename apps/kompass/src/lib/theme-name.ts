/** Schlüssel des mitgelieferten Themes (Kern, `DEFAULT_THEME`). */
export const DEFAULT_THEME_KEY = 'default';

/**
 * Name eines Themes in der Oberfläche: Das mitgelieferte heißt „Vorgabe“ (MUSTER § Begriffe, Runde 3 152/179); sein
 * gespeicherter Name „Default“ bleibt, weil er Teil des Seeds ist und nicht geändert werden kann.
 */
export function themeDisplayName(theme: { key: string; name: string }, defaultName: string): string {
  return theme.key === DEFAULT_THEME_KEY ? defaultName : theme.name;
}
