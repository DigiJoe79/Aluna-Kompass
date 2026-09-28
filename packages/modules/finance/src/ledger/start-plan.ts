import type { z } from 'zod';
import { categoryFieldsSchema } from './categories';

type CategorySeed = z.input<typeof categoryFieldsSchema>;

/**
 * Anhang A der Finanz-Spec, an SKR 42 angelehnt, generisch ohne Tier- oder
 * Vereinsbegriffe. Der Verein ergänzt eigene Kategorien (eine Schutzgebühr
 * etwa: Zweckbetrieb, `fees`, `reduced`).
 */
export const START_PLAN: readonly CategorySeed[] = [
  { key: 'donations', name: 'Geldspenden', direction: 'income', sphere: 'ideal', incomeKind: 'donation', statementSuffices: true },
  { key: 'membership-fees', name: 'Mitglieds- und Förderbeiträge', direction: 'income', sphere: 'ideal', incomeKind: 'membershipFee', statementSuffices: true },
  { key: 'in-kind-donations', name: 'Sachspenden', direction: 'income', sphere: 'ideal', incomeKind: 'inKindDonation' },
  { key: 'expense-waivers', name: 'Aufwandsspenden', direction: 'income', sphere: 'ideal', incomeKind: 'expenseWaiver' },
  { key: 'platform-payouts', name: 'Auszahlung Spendenplattform', explanation: 'Die Plattform stellt die Bestätigungen aus.', direction: 'income', sphere: 'ideal', incomeKind: 'bodyGrant', statementSuffices: true },
  { key: 'body-grants', name: 'Zuwendungen anderer Organisationen', direction: 'income', sphere: 'ideal', incomeKind: 'bodyGrant' },
  { key: 'public-grants', name: 'Zuschüsse', direction: 'income', sphere: 'ideal', incomeKind: 'publicGrant' },
  { key: 'court-fines', name: 'Geldauflagen', direction: 'income', sphere: 'ideal', incomeKind: 'courtFine', statementSuffices: true },
  { key: 'inheritances', name: 'Erbschaften und Vermächtnisse', direction: 'income', sphere: 'ideal', incomeKind: 'inheritance' },
  { key: 'cash-surplus', name: 'Kassendifferenz', direction: 'income', sphere: 'ideal', incomeKind: 'other' },
  { key: 'program-costs', name: 'Zweckausgaben', direction: 'expense', sphere: 'ideal', costFunction: 'program' },
  { key: 'program-in-kind', name: 'Sachaufwand aus Sachspenden', direction: 'expense', sphere: 'ideal', costFunction: 'program' },
  { key: 'partner-transfers', name: 'Förderung von Partnern', direction: 'expense', sphere: 'ideal', costFunction: 'program' },
  { key: 'partner-assignments', name: 'Aufträge an Partner', direction: 'expense', sphere: 'ideal', costFunction: 'program' },
  { key: 'travel', name: 'Fahrt- und Reisekosten', direction: 'expense', sphere: 'ideal', costFunction: 'program' },
  { key: 'volunteer-allowance', name: 'Ehrenamtspauschalen', direction: 'expense', sphere: 'ideal', costFunction: 'administration', allowanceKind: 'volunteer' },
  { key: 'trainer-allowance', name: 'Übungsleiterpauschalen', direction: 'expense', sphere: 'ideal', costFunction: 'program', allowanceKind: 'trainer' },
  { key: 'office', name: 'Büro, Porto, Telefon', direction: 'expense', sphere: 'ideal', costFunction: 'administration' },
  { key: 'it', name: 'Software und Internet', direction: 'expense', sphere: 'ideal', costFunction: 'administration' },
  { key: 'insurance-fees', name: 'Versicherungen, Beiträge, Gebühren', direction: 'expense', sphere: 'ideal', costFunction: 'administration' },
  { key: 'legal', name: 'Notar, Register, Beratung', direction: 'expense', sphere: 'ideal', costFunction: 'administration' },
  { key: 'bank-fees', name: 'Bankgebühren', direction: 'expense', sphere: 'ideal', costFunction: 'administration', statementSuffices: true },
  { key: 'payment-fees', name: 'Gebühren Zahlungsdienst', direction: 'expense', sphere: 'ideal', costFunction: 'fundraising', statementSuffices: true },
  { key: 'fundraising', name: 'Werbung und Spendenaufrufe', direction: 'expense', sphere: 'ideal', costFunction: 'fundraising' },
  { key: 'cash-shortage', name: 'Kassenfehlbetrag (Pflichttext)', explanation: 'Fehlbetrag bei der Kassenzählung. Die Buchung verlangt eine Begründung.', direction: 'expense', sphere: 'ideal', costFunction: 'administration' },
  { key: 'interest', name: 'Zinsen und Kapitalerträge (brutto)', explanation: 'Brutto buchen; die einbehaltene Steuer steht in einer eigenen Kategorie.', direction: 'income', sphere: 'assetManagement', incomeKind: 'interest', statementSuffices: true },
  { key: 'withheld-capital-tax', name: 'Einbehaltene Kapitalertragsteuer', explanation: 'Einbehaltene Steuer auf Kapitalerträge; eine Erstattung wird als negative Ausgabe gebucht.', direction: 'expense', sphere: 'assetManagement', costFunction: 'administration', statementSuffices: true },
  { key: 'asset-costs', name: 'Kosten der Vermögensverwaltung', direction: 'expense', sphere: 'assetManagement', costFunction: 'administration' },
  { key: 'purpose-income', name: 'Entgelte im Zweckbetrieb', direction: 'income', sphere: 'purposeOperation', incomeKind: 'fees', defaultTaxCode: 'reduced', countsTowardTurnover: true },
  { key: 'purpose-costs', name: 'Kosten im Zweckbetrieb', direction: 'expense', sphere: 'purposeOperation', costFunction: 'program' },
  { key: 'sales', name: 'Verkaufserlöse', direction: 'income', sphere: 'business', incomeKind: 'sales', defaultTaxCode: 'standard', countsTowardTurnover: true },
  { key: 'events', name: 'Veranstaltungen', direction: 'income', sphere: 'business', incomeKind: 'sales', defaultTaxCode: 'standard', countsTowardTurnover: true },
  { key: 'sponsoring', name: 'Sponsoring', direction: 'income', sphere: 'business', incomeKind: 'sponsoring', defaultTaxCode: 'standard', countsTowardTurnover: true },
  { key: 'business-costs', name: 'Kosten im Geschäftsbetrieb', direction: 'expense', sphere: 'business', costFunction: 'administration' },
  { key: 'vat-payment', name: 'Umsatzsteuer ans Finanzamt', direction: 'expense', sphere: 'business', costFunction: 'administration', statementSuffices: true },
  { key: 'vat-refund', name: 'Umsatzsteuer-Erstattung', direction: 'income', sphere: 'business', incomeKind: 'other', statementSuffices: true },
  { key: 'not-ours', name: 'Gehört nicht dem Verein', direction: 'transit' },
];
