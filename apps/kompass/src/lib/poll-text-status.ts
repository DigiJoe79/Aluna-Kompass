/**
 * Fragt den Stand der Texterkennung eines Dokuments ab, bis er umschlägt.
 *
 * Die nächste Abfrage wird erst nach der vorigen geplant (kein Überlapp), der
 * Abstand wächst von 1 s auf höchstens 5 s. Jede Abfrage hat eine Frist, damit
 * eine hängende Verbindung die Kette nicht einfriert.
 *
 * - Stand nicht mehr pending/running: `onDone` genau einmal, Ende.
 * - 401: `onUnauthorized` einmal (die Seite erneuert sich, die Anmeldung der
 *   Anwendung übernimmt), Ende. 403/404: `onGiveUp`, Ende ohne Erneuerung — das
 *   Dokument ist weg oder nicht mehr lesbar, es gibt nichts abzufragen.
 * - Netzfehler, Zeitüberschreitung, 5xx: weiter mit Abstand, nach `maxFailures`
 *   Fehlern in Folge `onGiveUp`, Ende.
 *
 * `onGiveUp` ist Pflicht: Die Karte zeigt sonst weiter „läuft“, obwohl niemand mehr fragt.
 *
 * - `onTick`: jeder gelesene Stand, auch der letzte (vor `onDone`) — für Karten, die den Fortschritt zeigen.
 *
 * Gibt eine Funktion zurück, die die Kette beendet (Unmount).
 */
export function pollTextStatus(options: {
  url: string;
  onDone: () => void;
  onUnauthorized?: () => void;
  onGiveUp: () => void;
  maxFailures?: number;
  timeoutMs?: number;
  /** Ob der Stand noch läuft; Vorgabe: Texterkennung (`textStatus` pending/running). Auch für den Mailversand. */
  isPending?: (body: Record<string, unknown>) => boolean;
  onTick?: (body: Record<string, unknown>) => void;
}): () => void {
  const { url, onDone, onUnauthorized, onGiveUp, maxFailures = 5, timeoutMs = 10_000 } = options;
  const isPending = options.isPending ?? ((b) => b.textStatus === 'pending' || b.textStatus === 'running');
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
    let body: Record<string, unknown> | null = null;
    try {
      response = await fetch(url, { cache: 'no-store', signal: abort.signal });
      if (response.ok) body = (await response.json()) as Record<string, unknown>;
    } catch {
      response = null;
    } finally {
      clearTimeout(deadline);
    }
    if (!active) return;
    if (response && response.status === 401) return onUnauthorized?.();
    if (response && (response.status === 403 || response.status === 404)) return onGiveUp();
    if (body) {
      failures = 0;
      options.onTick?.(body);
      if (!isPending(body)) return onDone();
    } else if (++failures >= maxFailures) {
      return onGiveUp();
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
