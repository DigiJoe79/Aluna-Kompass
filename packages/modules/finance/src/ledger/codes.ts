/**
 * Deutsches Gemeinnützigkeitsrecht ist Code, keine Einstellung (Spec E17,
 * 5.1): Sphären, Einnahmearten, Kostenfunktionen, Steuerkennzeichen. Werte
 * und Sätze dazu sind datierte Einstellungen (`dated-series.ts`).
 */
export const SPHERES = ['ideal', 'assetManagement', 'purposeOperation', 'business'] as const;
export const DIRECTIONS = ['income', 'expense', 'transit'] as const;
export const INCOME_KINDS = ['donation', 'membershipFee', 'inKindDonation', 'expenseWaiver', 'bodyGrant', 'publicGrant', 'courtFine', 'sponsoring', 'sales', 'fees', 'interest', 'rent', 'inheritance', 'other'] as const;
/** Bescheinigungsfähig — und nur in der Sphäre `ideal` zulässig. */
export const CERTIFIABLE_INCOME_KINDS = ['donation', 'membershipFee', 'inKindDonation', 'expenseWaiver'] as const;
export const COST_FUNCTIONS = ['program', 'administration', 'fundraising'] as const;
/**
 * Jahresrechnung (0.4.5, St-L-9): Einnahmen über eine Spendenplattform — `confirmsItself` (die Plattform bestätigt
 * selbst; `bodyGrant`), `handlesOnly` (wickelt nur ab; Spende an den Verein, `donation`).
 */
export const DONATION_PLATFORMS = ['confirmsItself', 'handlesOnly'] as const;
export type DonationPlatform = (typeof DONATION_PLATFORMS)[number];
export const ALLOWANCE_KINDS = ['none', 'volunteer', 'trainer'] as const;
/**
 * Steuerkennzeichen der Zuordnungszeile. § 13b UStG ist getrennt nach Leistungen aus dem übrigen EU-Gebiet (§ 13b Abs. 1,
 * Kennzahlen 46/47 der Voranmeldung) und übrigen Fällen (§ 13b Abs. 2, Kz 84/85); dazu der innergemeinschaftliche Erwerb
 * (Kz 89/93). Spec E6 Teil 2.
 */
export const TAX_CODES = ['none', 'exemptCounted', 'exemptNotCounted', 'reduced', 'standard', 'rc13bEu', 'rc13bOther', 'icAcquisition'] as const;
/** Brutto = Netto; die Steuer schuldet der Verein in beiden Besteuerungsformen (§ 13b Abs. 5 UStG, § 1a UStG). */
export const REVERSE_CHARGE_CODES = ['rc13bEu', 'rc13bOther', 'icAcquisition'] as const;
/**
 * Die Mitgliedstaaten der EU als ISO-3166-Codes (Stand 2026: 27), Griechenland als `GR` (nicht `EL` wie in der
 * USt-IdNr.). Inland ist `DE` — § 13b und § 18 sind deutsches Recht (Prinzip 1), „EU-Ausland“ rechnet gegen `DE`.
 * Der Übertrag `finance_rc13b_split` (Migration) trägt dieselbe Liste als SQL-Literal.
 */
export const EU_MEMBER_STATES: readonly string[] = ['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK'];
/** Merkmal am Kontakt „Rechnungen mit Umkehr der Steuerschuld (§ 13b)“: Vorgabe `rc13bEu` bzw. `rc13bOther` für Ausgaben. */
export const CONTACT_REVERSE_CHARGE = ['eu', 'other'] as const;

/**
 * Kategorien, unter denen Mittel an Partner gebucht werden (Startplan: Förderung von Partnern, Aufträge an Partner) —
 * die Ausnahme der Prüffrage § 13b (E12) und der Hinweis `partnerPaymentMissing` (N20) erkennen sie gleich.
 */
export const PARTNER_GRANT_CATEGORY_KEYS: readonly string[] = ['partner-transfers', 'partner-assignments'];
export type ContactReverseCharge = (typeof CONTACT_REVERSE_CHARGE)[number];
/**
 * E6b (Spec Teil 3): Gründe des „Nein, weil …“ der Prüffrage § 13b, je Kontakt gemerkt — steuerfreie Zahlungsabwicklung
 * (§ 4 Nr. 8 d UStG), inländischer Anbieter, Ausnahme nach § 13b Abs. 6 UStG, Sonstiges (mit Text).
 */
export const REVERSE_CHARGE_DECLINE_REASONS = ['paymentServices', 'domesticProvider', 'exception13b6', 'other'] as const;
export type ReverseChargeDeclineReason = (typeof REVERSE_CHARGE_DECLINE_REASONS)[number];
export const INPUT_TAX = ['no', 'yes', 'partial'] as const;
/**
 * Rechenschaft D2: warum eine Zuwendung nicht dem Vermögen zugeführt wird, obwohl die Vorgabe es tut — je Grund nur zu
 * seiner Art: Erbschaft (§ 62 Abs. 3 Nr. 1 AO) bzw. erhaltene Vermögensausstattung (§ 58 Nr. 3 AO, AEAO zu § 62 Nr. 16).
 */
export const ADDS_TO_ASSETS_OPT_OUTS = ['testatorDirectedCurrentUse', 'donorAllowedCurrentUse'] as const;
export type AddsToAssetsOptOut = (typeof ADDS_TO_ASSETS_OPT_OUTS)[number];

/** Grenze der Erläuterung zur Jahresrechnung in Zeichen (Spec Teil J) — hier, damit auch der Zähler im Browser sie kennt. */
export const ANNUAL_ACCOUNTS_EXPLANATION_MAX = 4000;
