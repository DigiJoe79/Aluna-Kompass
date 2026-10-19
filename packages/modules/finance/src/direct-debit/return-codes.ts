/**
 * Rückgabegründe einer Lastschrift (Spec Mitglieder und Lastschrift § 7.7, Handoff 2a § 1.3 13c): der Code der Bank
 * (`RtrInf/Rsn/Cd`) im Klartext und ob Kompass „Mandat beenden“ vorschlägt. Die Texte stehen in der Sprachdatei;
 * ein unbekannter Code heißt „Grund {code}“. Rein.
 */
export interface ReturnCodeDefinition {
  textKey: string;
  /** Konto erloschen, kein Mandat, Widerspruch: Mit diesem Mandat wird nicht mehr eingezogen. */
  suggestEndMandate: boolean;
}

const key = (code: string) => `finance.directDebit.returnCodes.${code}`;

export const RETURN_CODES: Record<string, ReturnCodeDefinition> = {
  AC01: { textKey: key('AC01'), suggestEndMandate: false },
  AC04: { textKey: key('AC04'), suggestEndMandate: true },
  AC06: { textKey: key('AC06'), suggestEndMandate: false },
  AG01: { textKey: key('AG01'), suggestEndMandate: false },
  AM04: { textKey: key('AM04'), suggestEndMandate: false },
  MD01: { textKey: key('MD01'), suggestEndMandate: true },
  MD06: { textKey: key('MD06'), suggestEndMandate: true },
  MS02: { textKey: key('MS02'), suggestEndMandate: false },
  MS03: { textKey: key('MS03'), suggestEndMandate: false },
  SL01: { textKey: key('SL01'), suggestEndMandate: false },
};

/** Der Code mit Klartext-Schlüssel; unbekannt: `unknown` mit dem Code als Wert `{code}`. */
export function returnCodeInfo(code: string): ReturnCodeDefinition & { code: string } {
  const known = RETURN_CODES[code];
  return known ? { code, ...known } : { code, textKey: key('unknown'), suggestEndMandate: false };
}
