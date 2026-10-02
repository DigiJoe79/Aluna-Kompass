import type { DragItem } from './folder-tree-model';

/** Ziehgut einer oder mehrerer Zeilen der Akte: JSON-Liste der Dokument-IDs. */
export const DOCUMENTS_MIME = 'application/x-kompass-documents';
/** Ziehgut der Mediathek: JSON-Liste der Medien-IDs. */
export const MEDIA_MIME = 'application/x-kompass-media';
/** Ein Ordner aus dem Baum; Firefox beginnt ein Ziehen nur mit Inhalt. */
export const FOLDER_MIME = 'application/x-kompass-folder';

/**
 * Was gerade aus dieser Seite gezogen wird. Während des Ziehens gibt der
 * Browser nur die Typen heraus, nicht den Inhalt — der Baum braucht aber die
 * Herkunft der Dokumente, um „Liegt schon hier“ vorab zu zeigen. Kommt das
 * Ziehgut aus einem anderen Tab, bleibt es `null`, und erst das Ablegen liest
 * die IDs.
 */
let current: DragItem | null = null;
/** Löst die Horcher des laufenden Zugs. */
let release: (() => void) | null = null;

const MIME_OF: Partial<Record<DragItem['kind'], string>> = { documents: DOCUMENTS_MIME, assets: MEDIA_MIME };

/**
 * Merkt sich den Zug bis zu seinem Ende. Ende ist `dragend` **oder** ein
 * `drop` irgendwo im Fenster, beide in der Einfangphase am Fenster: Nimmt die
 * Liste das Verschieben vorweg, verschwindet die Quellzeile noch während des
 * Zugs, und ihr `dragend` erreicht das Fenster nie.
 */
export function beginDrag(item: DragItem) {
  release?.();
  current = item;
  if (typeof window === 'undefined') return;
  const end = () => {
    // Erst nach dem `drop` am Ziel vergessen, das ihn noch lesen will.
    setTimeout(() => {
      if (current === item) current = null;
    }, 0);
    stop();
  };
  const stop = () => {
    window.removeEventListener('dragend', end, true);
    window.removeEventListener('drop', end, true);
    if (release === stop) release = null;
  };
  window.addEventListener('dragend', end, true);
  window.addEventListener('drop', end, true);
  release = stop;
}

/**
 * Der gemerkte Zug. Mit `types` (aus dem DataTransfer des laufenden Zugs) nur,
 * wenn der Zug dieses Ziehgut auch trägt — sonst ist das Gedächtnis von einem
 * Zug übrig, dessen Ende nicht ankam.
 */
export function currentDrag(types?: readonly string[]): DragItem | null {
  if (!current || !types) return current;
  const mime = MIME_OF[current.kind];
  return mime && !types.includes(mime) ? null : current;
}

/**
 * Ob der laufende Zug in diesem Dokument begann. Ein Bild oder Link aus der
 * Seite trägt beim Ziehen oft auch `Files` — Chrome legt das Bild selbst als
 * Datei bei. Wer daran „Dateien vom Rechner“ abliest, lädt eine Kopie hoch,
 * statt zu verschieben (Abnahme 01.10.: eine Kachel auf einen Ordner gezogen,
 * im Ordner lag danach „image.png“). Ein Zug aus dem Dateimanager feuert hier
 * kein `dragstart`; nur er ist ein Hochladen.
 *
 * Ende ist `dragend` oder `drop`; kommt keins an (die Quelle verschwand mitten
 * im Zug), räumt die nächste Mausbewegung auf — während eines Zugs schickt der
 * Browser keine.
 */
let internal = false;

if (typeof window !== 'undefined') {
  const end = () => {
    // Erst nach dem `drop` am Ziel, das noch fragen will.
    setTimeout(() => {
      internal = false;
    }, 0);
  };
  window.addEventListener('dragstart', () => (internal = true), true);
  window.addEventListener('dragend', end, true);
  window.addEventListener('drop', end, true);
  window.addEventListener('pointermove', () => (internal = false), { capture: true, passive: true });
}

/**
 * Ob die Typen eines Zugs Dateien von außen melden — nicht ein Bild, das der
 * Browser aus der Seite beilegt, und nicht ein Zug mit eigenem Ziehgut (aus
 * einem zweiten Kompass-Tab, wo `internal` nicht gesetzt ist).
 */
export function isOutsideUpload(types: readonly string[] | null | undefined): boolean {
  if (!types || internal || !types.includes('Files')) return false;
  return ![DOCUMENTS_MIME, MEDIA_MIME, FOLDER_MIME].some((mime) => types.includes(mime));
}

/** Bringt der Zug Dateien von außen mit? */
export function carriesOutsideFiles(transfer: DataTransfer | null | undefined): boolean {
  return isOutsideUpload(transfer?.types ? Array.from(transfer.types) : null);
}
