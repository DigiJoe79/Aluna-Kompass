import type { DbOrTx } from '@kompass/core';
import { addCalendarMonths } from '@kompass/module-finance';
import { eq } from 'drizzle-orm';
import { governanceResolutions, type FilingRow, type OccasionRow } from '../schema';
import { statuteValidOnInternal } from '../statutes';

/**
 * Hinweise zur Auflösung (Spec § 6, Steuerprüfung M2) — Daten des Moduls, Wortlaut unter `textKey`. Die Liquidation
 * selbst bleibt Nicht-Ziel; Kompass erinnert und hält fest.
 */
export const DISSOLUTION_HINTS = [
  { key: 'notice', norm: '§ 137 Abs. 1, 2 AO', textKey: 'governance.dissolution.hints.notice' },
  { key: 'liquidators', norm: '§§ 74, 76 BGB', textKey: 'governance.dissolution.hints.liquidators' },
  { key: 'assetLock', norm: '§ 55 Abs. 1 Nr. 4, § 61 AO', textKey: 'governance.dissolution.hints.assetLock' },
  { key: 'blockingYear', norm: '§ 51 BGB', textKey: 'governance.dissolution.hints.blockingYear' },
] as const;
export type DissolutionHint = (typeof DISSOLUTION_HINTS)[number]['key'];

export type DissolutionFacts = {
  decidedOn: string;
  /** Binnen eines Monats nach dem Beschluss (§ 137 AO); am Monatsende der letzte Tag (§ 188 Abs. 3 BGB). */
  noticeDueOn: string;
  taxOfficeNotifiedOn: string | null;
  municipalityNotifiedOn: string | null;
  liquidatorContactIds: string[];
  /** Aus dem am Beschlusstag gültigen Satzungsstand. */
  assetBeneficiary: string | null;
  announcedOn: string | null;
  /** Ende des Sperrjahrs ab Bekanntmachung (§ 51 BGB); ohne Bekanntmachung offen. */
  blockingYearEndsOn: string | null;
  hints: DissolutionHint[];
};

/** Die Fakten der Auflösung an einer Anmeldung mit Anlass `dissolution`, sonst `null`. */
export function dissolutionFactsInternal(db: DbOrTx, filing: Pick<FilingRow, 'dissolution'>, occasions: OccasionRow[]): DissolutionFacts | null {
  const occasion = occasions.find((o) => o.kind === 'dissolution');
  if (!occasion) return null;
  const decidedOn = occasion.occurredOn;
  const resolution = occasion.resolutionId ? db.select({ details: governanceResolutions.details }).from(governanceResolutions).where(eq(governanceResolutions.id, occasion.resolutionId)).get() : undefined;
  const liquidators = (resolution?.details as { liquidatorContactIds?: string[] } | null | undefined)?.liquidatorContactIds ?? [];
  const notices = filing.dissolution;
  const announcedOn = notices?.announcedOn ?? null;
  return {
    decidedOn,
    noticeDueOn: addCalendarMonths(decidedOn, 1),
    taxOfficeNotifiedOn: notices?.taxOfficeNotifiedOn ?? null,
    municipalityNotifiedOn: notices?.municipalityNotifiedOn ?? null,
    liquidatorContactIds: liquidators,
    assetBeneficiary: statuteValidOnInternal(db, decidedOn)?.rules.assetBeneficiary ?? null,
    announcedOn,
    blockingYearEndsOn: announcedOn ? addCalendarMonths(announcedOn, 12) : null,
    hints: DISSOLUTION_HINTS.map((h) => h.key),
  };
}
