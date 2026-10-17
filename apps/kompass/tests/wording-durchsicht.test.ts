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
    expect(at('dms.list.folderHere')).toBe('direkt hier');
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
});
