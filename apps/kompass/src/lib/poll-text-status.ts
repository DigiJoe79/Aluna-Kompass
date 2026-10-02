/**
 * Fragt den Stand der Texterkennung eines Dokuments ab, bis er umschlägt.
 *
 * Die nächste Abfrage wird erst nach der vorigen geplant (kein Überlapp), der
 * Abstand wächst von 1 s auf höchstens 5 s. Jede Abfrage hat eine Frist, damit
 * eine hängende Verbindung die Kette nicht einfriert.
 *
 * - Stand nicht mehr pending/running: `onDone` genau einmal, Ende.
 * - 401: `onUnauthorized` einmal (die Seite erneuert sich, die Anmeldung der
 *   Anwendung übernimmt), Ende. 403/404: Ende ohne Erneuerung — das Dokument ist
 *   weg oder nicht mehr lesbar, es gibt nichts abzufragen.
 * - Netzfehler, Zeitüberschreitung, 5xx: weiter mit Abstand, nach `maxFailures`
 *   Fehlern in Folge Ende.
 *
 * Gibt eine Funktion zurück, die die Kette beendet (Unmount).
 */
export function pollTextStatus(options: {
  url: string;
  onDone: () => void;
  onUnauthorized?: () => void;
  maxFailures?: number;
  timeoutMs?: number;
}): () => void {
  const { url, onDone, onUnauthorized, maxFailures = 5, timeoutMs = 10_000 } = options;
  let active = true;
  let delay = 1000;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;

  const poll = async () => {
    controller = new AbortController();
    const abort = controller;
    const deadline = setTimeout(() => abort.abort(), timeoutMs);
    let response: Response | null = null;
    let body: { textStatus: string | null } | null = null;
    try {
      response = await fetch(url, { cache: 'no-store', signal: abort.signal });
      if (response.ok) body = (await response.json()) as { textStatus: string | null };
    } catch {
      response = null;
    } finally {
      clearTimeout(deadline);
    }
    if (!active) return;
    if (response && response.status === 401) return onUnauthorized?.();
    if (response && (response.status === 403 || response.status === 404)) return;
    if (body) {
      failures = 0;
      if (body.textStatus !== 'pending' && body.textStatus !== 'running') return onDone();
    } else if (++failures >= maxFailures) {
      return;
    }
    delay = Math.min(delay * 2, 5000);
    timer = setTimeout(() => void poll(), delay);
  };

  timer = setTimeout(() => void poll(), delay);
  return () => {
    active = false;
    clearTimeout(timer);
    controller?.abort();
  };
}
