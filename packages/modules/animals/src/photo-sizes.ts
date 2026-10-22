import { mediaPixelSizes, type Deps, type PixelSizes } from '@kompass/core';

/**
 * Pixelmaße der Fotos (nach EXIF-Drehung, aus `media_assets`) für die Fotomaske: Ohne sie gibt es kein
 * „Ausschnitt …“ und keinen Hinweis auf die Breite (Spec Bildausschnitt § 4). Seit 0.2.11 im Kern
 * (`mediaPixelSizes`), weil jedes Bildfeld sie braucht.
 */
export function photoPixelSizes(deps: Pick<Deps, 'db'>, assetIds: readonly string[]): PixelSizes {
  return mediaPixelSizes(deps, assetIds);
}
