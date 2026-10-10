import { localizedConflict } from '@kompass/core';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { toActionState } from '@/lib/actions';
import messages from '../messages/de.json';

const t = createTranslator({ locale: 'de', messages, timeZone: 'Europe/Berlin' }) as never;
const detail = (code: string, params: Record<string, string>) => (toActionState(localizedConflict(code, `errors.${code}`, params), t) as { detail?: string }).detail;

/**
 * Backlog 55: Diese vier Konflikte zeigten nur den Teil nach dem Doppelpunkt (`rawDetail`) — Rechte-Schlüssel, einen
 * Code, eine nackte Liste oder einen im Dienst gebauten Satz. Jetzt Grund und Ausweg aus der Sprachdatei.
 */
describe('Ablehnungen mit Satz statt Detail (Backlog 55)', () => {
  it('nennt fehlende Rechte mit ihrer Beschriftung', () => {
    expect(detail('insufficientPrivileges', { permissionKeys: 'users.manage,finance.read' })).toBe(
      'Dafür fehlen Ihnen selbst Rechte: Nutzer verwalten und Finanzen lesen. Bitten Sie jemanden, der diese Rechte hat.',
    );
  });

  it('sagt, welcher Lauf der Webseite schon läuft', () => {
    expect(detail('siteJobRunning', { kind: 'publish' })).toBe('Die Webseite wird gerade veröffentlicht. Warten Sie, bis der Lauf fertig ist.');
    expect(detail('siteJobRunning', { kind: 'preview' })).toBe('Es läuft gerade eine Vorschau der Webseite. Warten Sie, bis der Lauf fertig ist.');
    expect(detail('siteJobRunning', { kind: 'unknown' })).toBe('Es läuft gerade ein Lauf der Webseite. Warten Sie, bis der Lauf fertig ist.');
  });

  it('nennt die Ablageregeln einer Dokumentart, jede in Anführungszeichen', () => {
    expect(detail('documentTypeHasRules', { label: 'Rechnung', matches: 'Rechnung\u001fMahnung' })).toBe(
      'Die Dokumentart „Rechnung“ wird noch von Ablageregeln genutzt: „Rechnung“ und „Mahnung“. Löschen oder ändern Sie zuerst diese Regeln.',
    );
  });

  it('sagt, bis wann ein Kontakt aufbewahrt wird', () => {
    expect(detail('retentionHoldActive', { permanent: 'no', untilText: '31.12.2027', holders: 'Interessent\u001fBuchung 2026-0012' })).toBe(
      'Der Kontakt wird noch bis 31.12.2027 aufbewahrt, gehalten von „Interessent“ und „Buchung 2026-0012“. Löschen ist nach Ablauf der Frist möglich; welche Fristen gelten, steht unter „Aufbewahrung“.',
    );
    // Datumsformat „ISO“: der Dienst schreibt das Datum so (messageDate), die Anzeige lässt es so stehen.
    expect(detail('retentionHoldActive', { permanent: 'no', untilText: '2028-12-31', holders: 'Interessent' })).toContain('noch bis 2028-12-31 aufbewahrt');
    expect(detail('retentionHoldActive', { permanent: 'yes', holders: 'Mitglied' })).toBe(
      'Der Kontakt wird dauerhaft aufbewahrt, gehalten von „Mitglied“. Löschen ist nach Ablauf der Frist möglich; welche Fristen gelten, steht unter „Aufbewahrung“.',
    );
  });
});
