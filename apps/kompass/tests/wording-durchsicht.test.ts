import { describe, expect, it } from 'vitest';
import messages from '../messages/de.json';

/** Wortlaut aus den Antworten des Designers (2026-10-16) und Joes Kleinfragen — je Punkt eine Prüfung. */
type Tree = { [key: string]: string | Tree };
const at = (path: string): string => path.split('.').reduce<string | Tree>((node, key) => (node as Tree)[key]!, messages as unknown as Tree) as string;
const all = (node: Tree, prefix = ''): [string, string][] =>
  Object.entries(node).flatMap(([key, value]) => (typeof value === 'string' ? [[`${prefix}${key}`, value] as [string, string]] : all(value, `${prefix}${key}.`)));

describe('Wortlaut der Durchsicht 0.2.11', () => {
  it('Optionstexte beginnen groß, auch hinter Doppelpunkt (Teil 1 Nr. 2)', () => {
    expect(at('dms.admin.areaNone')).toBe('Keiner');
    expect(at('finance.splitRow.taxNone')).toBe('Keine Angabe');
    for (const [key, value] of all(messages.finance.splitRow.taxCode as Tree)) expect(value[0], key).toBe(value[0]!.toUpperCase());
  });

  it('kein „keins“', () => {
    expect(all(messages as unknown as Tree).filter(([, value]) => /\bkeins\b/i.test(value))).toEqual([]);
  });

  it('Sperrhinweise der Akte mit halben Anführungszeichen innen (Teil 1 Nr. 5)', () => {
    expect(at('folderTree.block.outgoingOnly')).toBe('Unter ‚Ohne Ordner‘ liegen nur ausgehende Dokumente.');
    expect(at('folderTree.block.incomingOnly')).toBe('Im Eingangskorb liegen nur eingehende Dokumente.');
  });

  it('Sammel-Festschreiben: kein Auszug für diesen Zeitraum (Joe)', () => {
    expect(at('finance.work.batch.noStatement')).toBe('kein Auszug für diesen Zeitraum');
  });

  it('Webseite: Eintrag anlegen, leerer URL-Teil (14 A2, Teil 3 Nr. 13)', () => {
    expect(at('site.entries.create')).toBe('Eintrag anlegen');
    expect(at('errors.fields.slugRequired')).toBe('Bitte einen URL-Teil eingeben.');
  });

  it('Wiedervorlage ohne Zuständige heißt „Niemand Bestimmtes“, nicht „Alle“ (03 B37, Joe)', () => {
    expect(at('dms.followUps.unassigned')).toBe('Niemand Bestimmtes');
    expect((messages.dms.followUps as Record<string, string>).everyone).toBeUndefined();
  });

  it('verdeckte IBAN für Vorleser (Teil 1 Nr. 3)', () => {
    expect(at('finance.common.ibanEndsWith')).toBe('IBAN endet auf {last}');
  });

  it('Startseite: ein Wort je Sache (Teil B: 01 B9, 02 B8, 02 B9)', () => {
    // Der Titel gilt in beiden Zuständen; die Warnung sagt der Satz und der Ton im Kopf (01 B9).
    expect(at('dashboard.tiles.finance.nobodyCanApprove.title')).toBe('Freigabe von Auslagen');
    // „Letzter Auszug vor …“ klang wie die Zahl der Kachel „Letzter Auszug“; jetzt ist es die längste Lücke (02 B8).
    expect(at('dashboard.tiles.finance.todo.messages.lastStatement')).toMatch(/^Kontoauszüge fehlen für bis zu /);
    expect(at('dashboard.tiles.core.accounts.title')).toBe('Nutzerkonten');
  });

  it('Schale und Anmeldung (Teil B: 01 B23, 01 C29, 01 C31)', () => {
    // Kopfleiste und Seitentitel sagen dasselbe (01 B23).
    expect(at('nav.help')).toBe(at('help.title'));
    expect(at('auth.password.footer')).toBe('Ohne eigenes Passwort geht es nicht weiter. Der Wechsel wird protokolliert.');
    // Die Gruppe der Zeilenhöhen im Nutzermenü hat eine Überschrift (01 C31).
    expect(at('shell.userMenu.density')).toBe('Zeilenhöhe');
  });

  it('Akte, Liste und Baum (Teil C: 03 A2, 03 B11, 03 B13)', () => {
    // Über einem Ordner gilt die Ablage in diesen Ordner, nicht in den Eingangskorb (03 B13).
    expect(at('dms.drop.overlayHintFolder')).toBe('Die Akte nimmt nur PDF.');
    // „direkt hier“ ist entfallen: Ohne Unterordner fehlt die Spalte, direkt Abgelegtes zeigt „—“ (Runde 3, 022).
    expect(at('dms.list.folderHere')).toBeUndefined();
    expect(at('dms.empty.folderTitle')).toBe('Dieser Ordner ist leer');
  });

  it('Akte, Dokument und Dialoge (Teil C: 03 B24, 03 B32, 03 B36, 03 B39)', () => {
    expect(at('dms.fileConfirmDescription')).not.toMatch(/eingefroren/);
    expect(at('dms.fileConfirmDescription')).toMatch(/kann danach nicht mehr geändert werden/);
    expect(at('dms.noNumberYet')).toBe('Noch ohne Nummer');
    expect(at('moveDialog.titleOne')).toBe('Verschieben nach…');
    // Kein roher Markdown unter dem Brieftext, ein Link aufs Handbuch (03 B24).
    expect(at('dms.fields.bodyHint')).not.toMatch(/\*\*/);
    expect(at('dms.fields.bodyHint')).toMatch(/<link>.+<\/link>/);
  });

  it('Auslagen: der Satz hinter der Marke wiederholt den Zustand nicht (Runde 3, 100)', () => {
    expect(at('finance.expenses.sentence.draft')).toBe('vom {date}, noch nicht eingereicht');
    expect(at('finance.expenses.sentence.submitted')).toBe('am {date}, wartet auf Freigabe');
    expect(at('finance.expenses.sentence.approved')).toBe('am {date}, wird überwiesen');
  });

  it('ein Wort für die Umwidmung (Runde 3, 207)', () => {
    expect(at('finance.approvals.kind.purposeTransfer')).toBe('Umwidmung');
    expect(at('finance.purposes.transferDialog.title')).toBe('Umwidmung');
    expect(at('finance.purposes.detail.transfer')).toBe('Umwidmen');
    const texts = [
      'finance.approvals.transferReject.who',
      'finance.purposes.detail.fulfillConfirm',
      'finance.entryView.correct.proof.hint',
    ].map(at);
    for (const text of texts) expect(text).not.toMatch(/Zweck ändern/);
  });

  it('Spendenbuch: Abstimmung ohne Pfeil im Titel (Runde 3, 111)', () => {
    expect(at('finance.donations.book.reconciliation.title')).toBe('Abstimmung mit den Bestätigungen');
  });

  it('Ausstellen: die Unterschrift ist ein fester Wert mit Grund darunter (Runde 3, 106)', () => {
    expect(at('finance.donations.issue.signatureReason.machine')).toBe('Kompass setzt Name und Unterschrift der unterzeichnenden Person ein.');
    expect(at('finance.donations.issue.signatureReason.signatureField')).toBe('Die Bestätigung wird nach dem Ausdruck von Hand unterschrieben.');
  });

  it('Zurücknehmen: Kästchen als Aussage, Grund neben dem gesperrten Knopf (Runde 3, 108)', () => {
    expect(at('finance.donations.void.alreadySent')).toBe('Bereits versandt');
    expect(at('finance.donations.void.reasonMissing')).toBe('Zuerst einen Grund angeben.');
  });

  it('Partner: fehlende Rechtsform als Arbeit, Pflege als Link dahinter (Runde 3, 117)', () => {
    expect(at('finance.partners.detail.profile.legalFormNone')).toBe('Rechtsform nicht angegeben');
    expect(at('finance.partners.detail.profile.legalFormEdit')).toBe('am Kontakt pflegen');
    expect(at('finance.partners.detail.profile.legalForm')).toBe('Rechtsform: {legalForm}');
  });

  it('Zurückgelegtes Geld: der Höchstbetrag in einer Zeile, die Rechnung steht in der Hilfe (Runde 3, 123)', () => {
    expect(at('finance.reserves.cap.approximation')).toBe('Näherung, den genauen Wert nennt Ihre Steuerberatung.');
    expect(at('finance.reserves.resolution.label')).toBe('Beschluss');
  });
});
