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
  settlementExceedsLine: { reason: 'Die Summe der Zuordnungen übersteigt den Betrag der Geldzeile.', remedy: 'Verringern Sie eine Zuordnung, oder teilen Sie die Zahlung auf mehrere Zeilen auf.' },
  settlementWrongDirection: { reason: 'Eine Verbindlichkeit wird durch eine Ausgabe beglichen, eine Forderung durch eine Einnahme.', remedy: 'Prüfen Sie das Vorzeichen der Geldzeile oder wählen Sie den passenden Posten.' },
  openItemCancelled: { reason: 'Der Posten ist ohne Zahlung erledigt.', remedy: 'Wählen Sie einen offenen Posten, oder legen Sie einen neuen an.' },
  openItemInUse: { reason: 'Auf diesen Posten ist bereits eine Zahlung zugeordnet.', remedy: 'Ein zugeordneter Posten lässt sich nicht mehr ändern.' },
  openItemHasPayments: { reason: 'Auf diesen Posten ist bereits eine festgeschriebene Zahlung zugeordnet.', remedy: 'Stornieren Sie zuerst die Zahlung, bevor Sie den Posten ohne Zahlung erledigen.' },
  openItemHasOrigin: { reason: 'Dieser Posten hat eine Herkunft.', remedy: 'Er wird über seinen Vorgang erledigt.' },
  lineNotFinal: { reason: 'Die Zeile gehört zu einem Entwurf.', remedy: 'Ändern Sie den Entwurf direkt — eine Korrektur ist nur für festgeschriebene Zeilen.' },
  correctionChangesNothing: { reason: 'Keines der angegebenen Felder weicht vom aktuellen Wert ab.', remedy: 'Geben Sie mindestens eine tatsächliche Änderung an.' },
  purposeChangeNeedsProof: { reason: 'Der Zweck einer Einnahmezeile ändert sich nur mit einem Dokument, das die ursprüngliche Bestimmung des Spenders belegt.', remedy: 'Legen Sie ein festgeschriebenes Dokument als Nachweis mit an, oder buchen Sie eine Umwidmung.' },
  ownCorrection: { reason: 'Eine Korrektur gibt nicht frei, wer sie angelegt hat.', remedy: 'Lassen Sie eine andere Person mit dem Recht „Freigeben“ die Korrektur bestätigen.' },
  section153Unacknowledged: { reason: 'Für das Geschäftsjahr ist die Steuererklärung bereits abgegeben — die Änderung berührt § 153 AO.', remedy: 'Bestätigen Sie den Hinweis, um fortzufahren.' },
  contactLocked: { reason: 'Der Kontakt ist gesperrt: {reason}', remedy: 'Lösen Sie zuerst, was die Sperre begründet.' },
  correctionNotPending: { reason: 'Die Korrektur wartet nicht mehr auf eine Entscheidung.', remedy: 'Legen Sie bei Bedarf eine neue Korrektur an.' },
  correctionPendingExists: { reason: 'Für diese Zeile wartet schon eine Korrektur auf Freigabe.', remedy: 'Entscheiden Sie zuerst über die wartende Korrektur.' },
  draftsInPeriod: { reason: 'In der Periode stehen noch {count} Entwürfe.', remedy: 'Schreiben Sie sie fest oder löschen Sie sie.' },
  undocumentedEntries: { reason: 'In der Periode stehen {count} Buchungen ohne Beleg.', remedy: 'Reichen Sie den Beleg nach, legen Sie einen Eigenbeleg an, oder begründen Sie, warum es keinen gibt.' },
  previousYearOpen: { reason: 'Das Vorjahr ist noch nicht abgeschlossen.', remedy: 'Geschäftsjahre schließen in ihrer Reihenfolge: Schließen Sie zuerst das Vorjahr.' },
  fiscalYearAlreadyClosed: { reason: 'Das Geschäftsjahr {year} ist bereits abgeschlossen.', remedy: 'Öffnen Sie es bei Bedarf wieder (Recht „Geschäftsjahr abschließen“).' },
  fiscalYearNotEnded: { reason: 'Das Geschäftsjahr {year} ist noch nicht zu Ende.', remedy: 'Ein Geschäftsjahr lässt sich frühestens nach seinem Enddatum abschließen.' },
  fiscalYearNotClosed: { reason: 'Das Geschäftsjahr {year} ist nicht abgeschlossen.', remedy: 'Nur ein abgeschlossenes Geschäftsjahr lässt sich wieder öffnen.' },
  laterYearClosed: { reason: 'Ein späteres Geschäftsjahr ist bereits abgeschlossen.', remedy: 'Öffnen Sie zuerst das spätere Geschäftsjahr wieder — Jahre öffnen in umgekehrter Reihenfolge.' },
  cashCountNeedsNote: { reason: 'Bei einem Fehlbetrag ist ein Satz zur Erklärung Pflicht.', remedy: 'Tragen Sie ein, was fehlt oder wo der Betrag geblieben ist.' },
  cashCountSameCounter: { reason: 'Die beiden Zählenden müssen unterschiedliche Personen sein.', remedy: 'Wählen Sie eine zweite Person.' },
  cashCountCounterNotPerson: { reason: 'Zählende sind Personen, keine Organisationen.', remedy: 'Wählen Sie einen Kontakt der Art Person.' },
  cashCountNotCash: { reason: 'Das Konto {account} ist kein Barkonto.', remedy: 'Zählen lässt sich nur eine Kasse oder Spendendose.' },
  cashCountInFuture: { reason: 'Das Zähldatum liegt in der Zukunft.', remedy: 'Wählen Sie den heutigen Tag oder einen vergangenen.' },
  cashMoveNeedsOneCash: { reason: 'Eine Bargeldbewegung braucht genau ein Barkonto — das andere ist ein Bankkonto.', remedy: 'Wählen Sie ein Bankkonto und ein Barkonto.' },
  switchUiOnly: { reason: 'Dieser Schalter lässt sich nur am Bildschirm ändern.', remedy: 'Melden Sie sich an und ändern Sie ihn dort.' },
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
