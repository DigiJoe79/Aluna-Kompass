import type { OfficeFunction } from './schema';

/**
 * Die Kontaktrollen, die aus einem Amt folgen (Spec Gremien § 3.4). `board-member` und `treasurer` definieren die
 * Finanzen, `auditor` Gremien. Die Zeile `board-member` trägt den Namen des Amts als Notiz — die Finanzen lesen das Amt
 * daraus (`finance/src/closing/assembly.ts`).
 */
export function rolesForFunction(fn: OfficeFunction | null): string[] {
  switch (fn) {
    case 'chair':
    case 'board':
      return ['board-member'];
    case 'treasurer':
      return ['board-member', 'treasurer'];
    case 'auditor':
      return ['auditor'];
    default:
      return [];
  }
}

/** Notiz der Rollenzeile: der Name des Amts an `board-member`, sonst keine. */
export const roleNote = (role: string, officeName: string): string | null => (role === 'board-member' ? officeName : null);
