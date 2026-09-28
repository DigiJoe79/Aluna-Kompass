/**
 * Reine Regeln für die Nachweise einer Zahlung an einen Partner (F7, Spec
 * 8.1, Annahme 10). Kein Import — weder `@kompass/*` noch relativ —, damit
 * die Datei auch im Client läuft (`ALLOWED_VALUE_SUBPATHS`,
 * `client-imports.test.ts`) und der Dienst (`allocation/evidence.ts`) sie
 * ohne Datenbank ausführen kann (Muster `csv-purity.test.ts`,
 * `suggest-purity.test.ts`).
 *
 * `validNotice` (Annahme 1, 5) ist die Prüfung, ob am Zahlungstag ein
 * gültiger Bescheid des Partners vorliegt — keine eigene Dokumentart, deshalb
 * hier nicht als Nachweisart geführt.
 */

export type PartnerBasis = 'transfer58' | 'agent57';
export type PartnerStatus = 'taxExemptBody' | 'foreignBody' | 'publicBody' | 'agent';
/**
 * Die Nachweisarten nach Spec 14.4 (Entscheidung 4, Joe 2026-09-28):
 * `agreement` ist die Vereinbarung einer Förderung und — bei einem Auftrag an
 * einen Partner — der Auftrag je Vorhaben (die Oberfläche benennt sie nach
 * der Art); `invoice` „Rechnung oder Abrechnung“ (Förderung im Ausland),
 * `settlement` „Abrechnung mit Belegen“ (Auftrag). Ein Foto ist Teil eines
 * Berichts, keine eigene Art.
 */
export type EvidenceKind = 'agreement' | 'paymentProof' | 'recipientReceipt' | 'invoice' | 'settlement' | 'report';

/** Arten, die ältere Daten noch tragen können — gelesen als ihre heutige Art (`normalizeEvidenceKind`), nie mehr angelegt. */
export type LegacyEvidenceKind = 'assignment' | 'photo';

export const EVIDENCE_KINDS = ['agreement', 'paymentProof', 'recipientReceipt', 'invoice', 'settlement', 'report'] as const satisfies readonly EvidenceKind[];

/**
 * Abbildung beim Lesen (Design-Nachtrag Phase 4, Task 2): Bis zum 28.09.2026
 * hieß die Zusage einer Förderung `assignment`, und es gab ein eigenes
 * `photo`. Gespeichert bleibt, was war — ein anerkannter Nachweis ist per
 * Trigger unveränderlich —, gelesen wird die heutige Art.
 */
export function normalizeEvidenceKind(kind: EvidenceKind | LegacyEvidenceKind): EvidenceKind {
  if (kind === 'photo') return 'report';
  if (kind === 'assignment') return 'agreement';
  return kind;
}

/** Der Name einer Art in Oberfläche und Betreff: bei einem Auftrag heißt die Vereinbarung „Auftrag je Vorhaben“ (Spec 14.4, P). */
export type EvidenceKindLabelKey = EvidenceKind | 'agreementAgent57';

export function evidenceKindLabelKey(kind: EvidenceKind, basis: PartnerBasis): EvidenceKindLabelKey {
  return kind === 'agreement' && basis === 'agent57' ? 'agreementAgent57' : kind;
}

/**
 * AL (Recheck sha-0170e73): Sprachtabelle für den **gespeicherten** Betreff
 * eines abgelegten Nachweises — Nutzdaten, keine Oberfläche (Prinzip 7).
 * Dieselben Wörter wie `finance.partners.payment.requiredEvidence.kind` und
 * die Meldungen aus P; `apps/kompass/tests/finance-evidence-kind-messages.test.ts`
 * hält beide gleich.
 */
export const EVIDENCE_KIND_NAMES: { de: Record<EvidenceKindLabelKey, string> } & Record<string, Record<EvidenceKindLabelKey, string>> = {
  de: {
    agreement: 'Vereinbarung',
    agreementAgent57: 'Auftrag je Vorhaben',
    paymentProof: 'Zahlungsnachweis',
    recipientReceipt: 'Empfangsbestätigung',
    invoice: 'Rechnung oder Abrechnung',
    settlement: 'Abrechnung mit Belegen',
    report: 'Bericht',
  },
};

/**
 * Betreff eines hochgeladenen Nachweises: Art in Worten und Tag, nie der
 * Name des Partners (Annahme 9). Er wird gespeichert und entsteht deshalb in
 * der Leitsprache der Installation (`locale`), nicht in der des Aufrufers;
 * ohne eigene Tabelle auf Deutsch.
 */
export function evidenceSubject(kind: EvidenceKind, basis: PartnerBasis, dateIso: string, locale: string): string {
  // Heute gibt es nur die deutsche Tabelle; eine weitere Sprache bringt mit ihren Wörtern auch ihr Satzmuster mit.
  const names = EVIDENCE_KIND_NAMES[locale] ?? EVIDENCE_KIND_NAMES.de;
  const [y, m, d] = dateIso.slice(0, 10).split('-');
  return `${names[evidenceKindLabelKey(kind, basis)]} vom ${d}.${m}.${y}`;
}

/**
 * Nachweisarten, die einen Betrag decken müssen: nur die Abrechnung mit Belegen
 * eines Auftrags (V, Prüfer Block 2 — § 58 AO verlangt bei einer Förderung keine
 * betragsgenaue Deckung; „Rechnung oder Abrechnung“ trägt dort keinen Betrag).
 */
export const AMOUNT_EVIDENCE_KINDS: readonly EvidenceKind[] = ['settlement'];

export interface EvidenceRequirementInput {
  basis: PartnerBasis;
  partnerStatus: PartnerStatus;
  /** Mindestens eine Position ist eine Sache (`kind: 'goods'`). */
  hasGoodsPositions: boolean;
}

/**
 * Die Pflichtarten einer Zahlung (Spec 8.1, HANDOFF 14.4): Ein
 * Zahlungsnachweis gehört immer dazu. Ein Auftrag an einen Partner
 * (`agent57`, jeder Status) braucht den Auftrag je Vorhaben, die Abrechnung
 * mit Belegen und einen Bericht. Eine Förderung eines Partners im Ausland
 * braucht Vereinbarung, Empfangsbestätigung, Rechnung oder Abrechnung und
 * einen Bericht; im Inland genügt der Zahlungsnachweis (der gültige Bescheid
 * ist eine Prüfung beim Einreichen, keine Nachweisart). Sachen brauchen
 * zusätzlich eine Empfangsbestätigung.
 */
export function requiredEvidenceKinds(input: EvidenceRequirementInput): EvidenceKind[] {
  const kinds: EvidenceKind[] = ['paymentProof'];
  if (input.basis === 'agent57') kinds.push('agreement', 'settlement', 'report');
  else if (input.partnerStatus === 'foreignBody') kinds.push('agreement', 'recipientReceipt', 'invoice', 'report');
  if (input.hasGoodsPositions && !kinds.includes('recipientReceipt')) kinds.push('recipientReceipt');
  return kinds;
}

/**
 * Die Nachweisfrist (Entscheidung 2): n Monate nach dem Zahlungstag, am
 * selben Kalendertag; gibt es ihn im Zielmonat nicht, der letzte Tag des
 * Monats. Rein, ISO-Daten.
 */
export function proofDueDate(paymentDate: string, months: number): string {
  const [y, m, d] = paymentDate.split('-').map(Number) as [number, number, number];
  const target = (m - 1) + months;
  const year = y + Math.floor(target / 12);
  const month = (target % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export interface EvidenceRow {
  kind: EvidenceKind | LegacyEvidenceKind;
  documentId: string | null;
  foreignLanguage: boolean;
  explanationDe: string | null;
  coveredCents: number | null;
}

/**
 * Was am Vorgang fehlt, um ihn anzuerkennen (Annahme 11): jede fehlende
 * Pflichtart, jede fremdsprachige ohne Erläuterung, jede mit Betragspflicht
 * ohne Betrag. Ein Grabstein (`documentId: null`) zählt nicht als vorhanden.
 */
export function missingEvidence(required: readonly EvidenceKind[], evidence: readonly EvidenceRow[]): { missingKinds: EvidenceKind[]; missingExplanation: EvidenceKind[]; missingAmount: EvidenceKind[] } {
  const present = evidence.filter((e) => e.documentId !== null).map((e) => ({ ...e, kind: normalizeEvidenceKind(e.kind) }));
  const byKind = new Set(present.map((e) => e.kind));
  const missingKinds = required.filter((k) => !byKind.has(k));
  const missingExplanation = present.filter((e) => e.foreignLanguage && !e.explanationDe).map((e) => e.kind);
  const missingAmount = present.filter((e) => AMOUNT_EVIDENCE_KINDS.includes(e.kind) && e.coveredCents === null).map((e) => e.kind);
  return { missingKinds, missingExplanation, missingAmount };
}

/**
 * Ob die Deckung überhaupt geprüft wird (Annahme 10, 11): nur, wenn die
 * Pflichtarten selbst eine Betragsnachweis-Art verlangen (`settlement` bei
 * einem Auftrag an einen Partner). Eine reine Förderung braucht nur Zusage
 * und Zahlungsnachweis — ohne Rechnung gibt es nichts zu decken.
 */
export function coverageRequired(required: readonly EvidenceKind[]): boolean {
  return required.some((k) => AMOUNT_EVIDENCE_KINDS.includes(k));
}

/**
 * Deckung des Vorgangs (Annahme 10): Σ `coveredCents` der Betragsnachweise
 * gegen Σ Geld- und Sachpositionen — „belegt x von y €“ (Baustein
 * `LimitProgress`).
 */
export function evidenceCoverage(evidence: readonly Pick<EvidenceRow, 'kind' | 'coveredCents' | 'documentId'>[], totalCents: number): { coveredCents: number; totalCents: number; complete: boolean } {
  const coveredCents = evidence.filter((e) => e.documentId !== null && AMOUNT_EVIDENCE_KINDS.includes(normalizeEvidenceKind(e.kind))).reduce((sum, e) => sum + (e.coveredCents ?? 0), 0);
  return { coveredCents, totalCents, complete: coveredCents >= totalCents };
}

/**
 * Annahme 10: der Zahlungsnachweis gilt als erbracht, wenn die Zahlung
 * „passiert“ ist — bei einer üblichen Freigabe, wenn die aus ihr entstandene
 * Zahlung begleicht wurde; bei nachträglicher Freigabe sind die gewählten
 * Zeilen selbst schon festgeschrieben, also immer erbracht.
 */
export function paymentProofSatisfied(input: { retroactive: boolean; openItemSettled: boolean }): boolean {
  return input.retroactive || input.openItemSettled;
}
