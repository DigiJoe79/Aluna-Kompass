import { isModuleEnabled, type DbOrTx, type Deps } from '@kompass/core';
import type { StatuteSuggestion } from '@kompass/module-finance';
import { statuteValidOnInternal } from '../statutes';
import { governanceLabelText } from './labels';

/**
 * Quelle für die Anlage Gem der Finanzen (Spec § 8.1, G7): „Satzung in der Fassung vom“ ist das **jüngste
 * Beschlussdatum** des am Stichtag gültigen Stands — nicht der Tag der Eintragung —, das Dokument sein Wortlaut.
 * Ohne Gremien oder ohne gültigen Stand `null`.
 */
export function statuteSuggestionInternal(deps: Deps, db: DbOrTx, on: string): StatuteSuggestion | null {
  if (!isModuleEnabled(deps, 'governance')) return null;
  const stand = statuteValidOnInternal(db, on);
  const statuteDate = stand?.resolutions.map((r) => r.on).sort().at(-1);
  if (!stand || !statuteDate) return null;
  return { statuteDate, documentId: stand.documentId, source: { label: governanceLabelText(deps, 'governanceStatute', stand.id) ?? statuteDate, href: `/governance/statutes/${stand.id}` } };
}
