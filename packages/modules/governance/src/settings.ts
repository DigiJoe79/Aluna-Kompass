import type { SettingDefinition } from '@kompass/core';
import { z } from 'zod';

/** Einstellungen des Moduls (Spec Gremien § 4.1, § 7.1, § 10). */
export const GOVERNANCE_SETTINGS: readonly SettingDefinition[] = [
  // Wie Finanzen und Mitglieder: Satzungsstand eintragen (G1), Einladen, Festschreiben (ab G2) über einen Agenten erst,
  // wenn ein Mensch das freischaltet.
  { key: 'governance.mcpHumanOnlyAllowed', schema: z.boolean(), default: false, uiOnly: true },
  // Tage nach dem Beschluss, ab denen eine offene Registeranmeldung überfällig ist (Spec § 7.1, genutzt ab G5).
  { key: 'governance.registerOverdueDays', schema: z.number().int().min(1).max(365), default: 28 },
  // Tage nach der Eintragung einer Satzungsänderung, die die Gemeinnützigkeit berührt, bis die Satzung beim Finanzamt
  // eingereicht und ein neuer Bescheid nach § 60a AO angefordert sein sollte (Spec § 4.1, Joe 2026-10-28).
  { key: 'governance.taxNoticeRequestDays', schema: z.number().int().min(1).max(365), default: 28 },
  // Ab welchem Tag des Jahres (`MM-TT`) die Frist „ordentliche Versammlung noch nicht angesetzt“ erscheint (Spec § 11,
  // Designer Phase 2, Joe 2026-10-28: Vorgabe 1. Oktober).
  // Tage vor dem letzten Tag der Einladung, ab denen eine geplante Sitzung „Einladung bis …“ trägt (Spec § 12.9
  // „Fristen-Vorlauf“, Plan U1 Entscheidung 6).
  { key: 'governance.deadlineLeadDays', schema: z.number().int().min(0).max(90), default: 7 },
  { key: 'governance.ordinaryMeetingWarnFrom', schema: z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/), default: '10-01' },
];
