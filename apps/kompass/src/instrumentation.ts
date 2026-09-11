import { startBackgroundWork } from '@/lib/background';

/**
 * Next ruft das beim Serverstart — einmal je Prozess, vor der ersten Anfrage.
 * Hier hängt der Worker der Texterkennung; Task 4 füllt `onStart`.
 */
export function register(): void {
  startBackgroundWork({
    onStart: () => {
      console.log('[kompass] Hintergrundarbeit gestartet');
    },
  });
}
