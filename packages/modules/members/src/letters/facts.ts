import type { TransferBlockData } from '@kompass/documents/transfer-block';
import type { FeeInterval, PaymentMethod } from '../schema';
import type { DirectDebitFacts } from './shared';

/** Was jeder Brief über Empfänger und Verein wissen muss — gesammelt in `issue.ts`, rein verwendet in den Arten. */
export interface LetterFacts {
  memberNumber: string;
  /** Anschrift als Zeilen mit `\n`; leer, wenn der Brief nur per E-Mail geht. */
  recipient: string;
  greeting: string;
  organizationName: string;
  /** Konto des Vereins für den Überweisungsblock; ohne IBAN kein Block. */
  bank: { iban: string; bic: string | null } | null;
  /** Ausstellungstag (ISO). */
  today: string;
  /** M3: Name des Mitglieds, wenn der Brief an jemand anderen geht (gesetzliche Vertretung); sonst `null`. */
  memberName: string | null;
}

/** Ein Beitrag, wie die Briefe ihn zeigen. */
export interface ChargeFacts {
  chargeId: string;
  period: string;
  year: string;
  dueOn: string;
  amountCents: number;
  paidCents: number;
  openCents: number;
  reference: string;
  /** Der Zahlweg am Beitrag (Plan N1 E3): Überweisung bekommt den Überweisungsblock, Lastschrift den Einzugstag. */
  method: PaymentMethod;
}

export interface FeeFacts {
  amountCents: number;
  interval: FeeInterval;
  method: PaymentMethod;
}

export type { DirectDebitFacts, TransferBlockData };
