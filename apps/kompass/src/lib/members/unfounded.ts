import { isModuleEnabled, type Deps } from '@kompass/core';
import { unfoundedNoticesInternal } from '@kompass/module-members';

/**
 * Spec Zahlung zuordnen § 3.4a: die unbegründeten Mahnungen zu einem Beitrag — für das Seitenfenster des Postens, das
 * zu den Finanzen gehört und die Mitglieder nicht kennt. Ohne eingeschaltetes Mitgliedermodul keine.
 */
export function unfoundedNoticesOf(deps: Deps, chargeId: string): ReturnType<typeof unfoundedNoticesInternal> {
  return isModuleEnabled(deps, 'members') ? unfoundedNoticesInternal(deps, deps.db, chargeId) : [];
}
