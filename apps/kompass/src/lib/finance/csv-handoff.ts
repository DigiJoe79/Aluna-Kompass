/**
 * Die Datei aus dem Zwischenschritt der Ablagefläche in den CSV-Assistenten
 * (Design-Nachtrag N3, W-1: „Format für ein Konto einrichten“ öffnet den
 * Assistenten **mit dieser Datei**). Über `sessionStorage`, weil eine
 * Navigation den Zustand der Seite verwirft; genau einmal lesbar. Scheitert
 * das Ablegen (Kontingent, gesperrter Speicher), meldet `stash` `false` — der
 * Assistent öffnet dann ohne Datei, und man wählt sie dort erneut.
 */
export const HANDOFF_KEY = 'finance.csvAssistant.handoff';

export interface CsvHandoff {
  name: string;
  bytes: Uint8Array;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function stashCsvHandoff(storage: Storage | null, file: CsvHandoff): boolean {
  if (!storage) return false;
  try {
    storage.setItem(HANDOFF_KEY, JSON.stringify({ name: file.name, base64: toBase64(file.bytes) }));
    return true;
  } catch {
    return false;
  }
}

export function takeCsvHandoff(storage: Storage | null): CsvHandoff | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(HANDOFF_KEY);
    storage.removeItem(HANDOFF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { name?: unknown; base64?: unknown };
    if (typeof parsed.name !== 'string' || typeof parsed.base64 !== 'string') return null;
    return { name: parsed.name, bytes: fromBase64(parsed.base64) };
  } catch {
    return null;
  }
}
