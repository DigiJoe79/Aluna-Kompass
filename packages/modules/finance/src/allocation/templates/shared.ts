/**
 * Der Wortlaut der Verzichtserklärung (F8a Annahme 10) — die eine Stelle
 * dafür. **Kein amtlicher Mustertext:** Für den Verzicht auf einen
 * Erstattungsanspruch gibt es kein Muster; der Text sagt nur, was die
 * Aufwandsspende trägt (BMF 25.11.2014 i. d. F. 24.08.2016): ein vorab
 * vereinbarter Anspruch (Vertrag oder Satzung), sein Betrag, der Verzicht und
 * die Unterschrift der verzichtenden Person. Deutsch, weil der Beleg
 * deutschem Recht folgt — wie die Muster der Zuwendungsbestätigungen.
 *
 * Rein: kein Import. Beträge und Daten kommen schon formatiert.
 */

export const WAIVER_TEMPLATE_KEY = 'finance-waiver-declaration';
export const WAIVER_DOCUMENT_TYPE = 'finance-waiver-declaration';
export const WAIVER_SIGNED_DOCUMENT_TYPE = 'finance-waiver-signed';

export const TITLE = 'Verzichtserklärung';
export const SUBTITLE = 'Verzicht auf die Erstattung von Aufwendungen';
export const ORGANIZATION_LABEL = 'Verein';
export const CLAIMANT_LABEL = 'Verzichtende Person';
export const BASIS_LABEL = 'Anspruchsgrundlage';

export const claimSentence = (claimNumber: string, amount: string) =>
  `Mit dem Antrag ${claimNumber} habe ich Aufwendungen für den Verein in Höhe von ${amount} geltend gemacht. Der Anspruch auf ihre Erstattung beruht auf der unten genannten Grundlage.`;
export const agreedSentence = (agreedOn: string) => `Die Grundlage wurde vereinbart am ${agreedOn}.`;
export const waiverSentence = (amount: string) =>
  `Ich verzichte hiermit auf die Erstattung in Höhe von ${amount} und wende den Betrag dem Verein als Spende zu. Der Verzicht erfolgt freiwillig und ohne Bedingung.`;

export const PLACE_DATE_LABEL = 'Ort, Datum';
export const SIGNATURE_LABEL = 'Unterschrift der verzichtenden Person';
