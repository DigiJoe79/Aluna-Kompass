import { conflict, type Failure } from '@kompass/core';

/**
 * Grund und Abhilfe je Fehlerschlüssel (Finanz-Spec 5.4: „Fehlerbilder sind
 * `Result`-Werte mit Grund **und** Abhilfe“). Eine Tabelle statt verstreuter
 * Texte, damit ein Test sie vollständig halten kann und F3 sie unverändert in
 * die Sprachdatei übernimmt. `financeConflict` ist die einzige Stelle im Modul,
 * die einen `conflict(…)` erzeugt (Wächter: `tests/errors.test.ts`).
 */
export const FINANCE_ERRORS = {
  accountInUse: { reason: 'Auf dieses Konto ist bereits gebucht.', remedy: 'Das Konto lässt sich stilllegen, aber nicht löschen.' },
  mainAccountMustBeBank: { reason: 'Das Hauptkonto kann nur ein Bankkonto sein.', remedy: 'Seine IBAN steht auf den Zuwendungsbestätigungen — wählen Sie ein Bankkonto.' },
  mainAccountMustStayActive: { reason: 'Das Hauptkonto lässt sich nicht stilllegen oder löschen.', remedy: 'Machen Sie zuerst ein anderes Konto zum Hauptkonto.' },
  categoryKeyTaken: { reason: 'Der Schlüssel {key} ist bereits vergeben.', remedy: 'Wählen Sie einen anderen Schlüssel.' },
  categoryInUse: { reason: 'Auf diese Kategorie ist bereits gebucht.', remedy: 'Die Kategorie lässt sich stilllegen, aber nicht löschen.' },
  purposeInUse: { reason: 'Auf diesen Zweck ist bereits gebucht.', remedy: 'Der Zweck lässt sich stilllegen, aber nicht löschen.' },
  purposeClosed: { reason: 'Der Zweck ist erfüllt oder aufgelöst.', remedy: 'Öffnen Sie ihn wieder, bevor Sie ihn ändern.' },
  fiscalYearExists: { reason: 'Es gibt bereits ein Geschäftsjahr.', remedy: 'Legen Sie weitere Geschäftsjahre über die Buchung an.' },
  designationLocked: { reason: 'Die Bezeichnung steht bereits in vergebenen Buchungsnummern.', remedy: 'Sie ist damit unveränderlich; legen Sie bei Bedarf ein neues Geschäftsjahr an.' },
  designationTaken: { reason: 'Die Bezeichnung {designation} ist bereits vergeben.', remedy: 'Wählen Sie eine andere Bezeichnung für das Geschäftsjahr.' },
  entryNotDraft: { reason: 'Buchung {number} ist festgeschrieben.', remedy: 'Festgeschriebenes wird nicht geändert: Stornieren Sie die Buchung und legen Sie eine neue an.' },
  entryNotFinal: { reason: 'Die Buchung ist noch ein Entwurf.', remedy: 'Ein Entwurf wird gelöscht, nicht storniert.' },
  entryUnbalanced: { reason: 'Es sind noch {rest} zu verteilen: Die Geldzeilen ergeben {money}, die Zuordnungen {allocated}.', remedy: 'Ergänzen oder ändern Sie eine Zuordnungszeile, bis beide Summen gleich sind.' },
  entryEmpty: { reason: 'Die Buchung hat keine Zeilen.', remedy: 'Fügen Sie mindestens eine Geldzeile oder ein Zuordnungspaar hinzu.' },
  accountInactive: { reason: 'Das Konto {account} ist stillgelegt.', remedy: 'Wählen Sie ein aktives Konto oder aktivieren Sie es unter „Finanzen einrichten“.' },
  categoryInactive: { reason: 'Die Kategorie {category} ist stillgelegt.', remedy: 'Wählen Sie eine aktive Kategorie oder aktivieren Sie sie unter „Finanzen einrichten“.' },
  fiscalYearClosed: { reason: 'Das Geschäftsjahr {year} ist abgeschlossen.', remedy: 'Buchen Sie im laufenden Jahr, oder öffnen Sie das Jahr wieder (Recht „Geschäftsjahr abschließen“).' },
  cashDraftNotAllowed: { reason: 'Bargeld wird am selben Tag festgehalten; ein Entwurf auf einem Barkonto lässt sich nicht parken.', remedy: 'Buchen Sie den Vorgang in einem Zug (festschreiben beim Speichern).' },
  cashWouldGoNegative: { reason: 'Das Barkonto {account} wäre am {date} mit {amount} im Minus.', remedy: 'Prüfen Sie Datum und Betrag, oder buchen Sie zuerst die fehlende Einnahme oder Abhebung.' },
  cashNegativeNeedsReason: { reason: 'Durch dieses Storno wäre das Barkonto {account} am {date} mit {amount} im Minus.', remedy: 'Geben Sie eine Begründung an; der Zeitraum steht dann im Prüfpaket.' },
  entryAlreadyReversed: { reason: 'Buchung {number} ist schon storniert (durch {by}).', remedy: 'Nichts zu tun.' },
  entryIsReversal: { reason: 'Buchung {number} ist selbst ein Storno.', remedy: 'Ein Storno wird nicht storniert: Legen Sie die Buchung neu an.' },
  entryLocked: { reason: 'Buchung {number} lässt sich nicht stornieren: {reason}', remedy: 'Lösen Sie zuerst, was darauf aufbaut.' },
  notReviewed: { reason: '{count} der gewählten Entwürfe sind nicht geprüft.', remedy: 'Der Sammellauf nimmt nur geprüfte Entwürfe: Prüfen Sie sie zuerst, oder schreiben Sie sie einzeln fest.' },
  noTaxRateForDate: { reason: 'Für den {date} ist kein Umsatzsteuersatz hinterlegt.', remedy: 'Tragen Sie den Satz unter „Finanzen einrichten → Werte“ mit seinem Stichtag ein.' },
  voucherTypeNotAllowed: { reason: 'Die Art „{type}“ gilt beim Verein nicht als Finanzbeleg.', remedy: 'Wählen Sie eine der hinterlegten Belegarten, oder tragen Sie die Art unter „Finanzen einrichten“ nach.' },
  documentNotFinal: { reason: 'Das Dokument ist noch ein Entwurf.', remedy: 'Ein Beleg braucht ein festgeschriebenes Dokument der Akte.' },
  documentVoided: { reason: 'Das Dokument ist storniert.', remedy: 'Verknüpfen Sie ein gültiges Dokument als Beleg.' },
  voucherAlreadyLinked: { reason: 'Dieses Dokument hängt schon als Beleg an der Buchung.', remedy: 'Verknüpfen Sie es nicht ein zweites Mal.' },
  voucherAlreadyRevoked: { reason: 'Dieser Beleg ist bereits widerrufen.', remedy: 'Ein Widerruf lässt sich nicht wiederholen.' },
  revokeNeedsReplacement: { reason: 'Das Geschäftsjahr {year} ist abgeschlossen.', remedy: 'Widerrufen Sie den Beleg, indem Sie ihn ersetzen: Geben Sie das richtige Dokument mit an.' },
} as const satisfies Record<string, { reason: string; remedy: string }>;

export type FinanceErrorCode = keyof typeof FINANCE_ERRORS;

function fill(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in params ? String(params[key]) : match));
}

/** `conflict(code, "<Grund> <Abhilfe>")`; `{platzhalter}` in beiden Texten werden aus `params` ersetzt. */
export function financeConflict(code: FinanceErrorCode, params?: Record<string, string | number>): Failure {
  const { reason, remedy } = FINANCE_ERRORS[code];
  return conflict(code, `${fill(reason, params)} ${fill(remedy, params)}`);
}
