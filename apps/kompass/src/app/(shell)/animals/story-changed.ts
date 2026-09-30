type Localized = Record<string, string>;
export interface StoryInput {
  beforeAssetId: string | null;
  afterAssetId: string | null;
  quote: Localized;
  family: string;
  adoptedYear: number;
  beforeCaption: Localized;
  afterCaption: Localized;
}

/** Leere Sprachfelder zählen nicht: Die Maske schickt `{ de: '', en: '' }`, gespeichert ist womöglich `{}`. */
const filled = (map: Localized | undefined) => JSON.stringify(Object.entries(map ?? {}).filter(([, text]) => text !== '').sort(([a], [b]) => a.localeCompare(b)));

/**
 * Ob die Geschichte der Maske vom gespeicherten Stand abweicht. Die Geschichte reist mit dem einen Speichern
 * der Maske; geschrieben wird sie nur bei einer Änderung – sonst stünde nach jedem Speichern eines vermittelten
 * Hunds ein leerer Eintrag im Protokoll.
 */
export function storyChanged(saved: StoryInput | null, next: StoryInput): boolean {
  if (!saved) return true;
  return (
    saved.beforeAssetId !== next.beforeAssetId ||
    saved.afterAssetId !== next.afterAssetId ||
    saved.family !== next.family ||
    saved.adoptedYear !== next.adoptedYear ||
    filled(saved.quote) !== filled(next.quote) ||
    filled(saved.beforeCaption) !== filled(next.beforeCaption) ||
    filled(saved.afterCaption) !== filled(next.afterCaption)
  );
}
