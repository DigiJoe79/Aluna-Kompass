/**
 * Was der Publish-Dialog nach einer Absage anbietet. `previewOutdated` kommt
 * einmal beim Start und einmal als Ergebnis des Laufs (der Dienst prüft den
 * Stand erst nach dem Export); beide führen zum selben Angebot.
 */
export function publishFollowUp(code: string | undefined): 'rebuildPreview' | null {
  return code === 'previewOutdated' ? 'rebuildPreview' : null;
}
