import { isoDay, paperDate, readSetting, type DbOrTx, type Deps } from '@kompass/core';
import { and, eq } from 'drizzle-orm';
import { documentSnippets } from '../schema';
import { MAIL_BODY_DEFAULTS } from './defaults';

export interface MailBodyDocument {
  typeKey: string;
  subject: string;
  number: string;
  documentDate: string;
}

export interface MailBodyRecipient {
  /** Der Name, unter dem der Kontakt angeschrieben wird (`displayName`). */
  name: string;
  /** Anrede des Kontakts („Frau“), leer bei Organisationen. */
  salutation: string | null;
}

/**
 * Welcher Baustein den Begleittext einer Dokumentart stellt: der der Art
 * (`dms.mail.bodySnippetByType`), sonst der der Grundausstattung. Ein
 * gelöschter oder abgeschalteter Baustein zählt nicht; dann der mitgelieferte
 * Text (`id: null`) — ein Versand scheitert nie am Begleittext.
 */
export function mailBodySnippetFor(deps: Deps, typeKey: string, db: DbOrTx = deps.db): { id: string | null; body: string } {
  const byType = readSetting<Record<string, string>>(deps, 'dms.mail.bodySnippetByType');
  const candidates = [byType[typeKey], readSetting<string | null>(deps, 'dms.mail.defaultBodySnippetId')].filter((id): id is string => !!id);
  for (const id of candidates) {
    const row = db.select({ body: documentSnippets.body }).from(documentSnippets).where(and(eq(documentSnippets.id, id), eq(documentSnippets.isActive, true))).get();
    if (row) return { id, body: row.body };
  }
  const locale = deps.locales()[0] ?? 'de';
  return { id: null, body: (MAIL_BODY_DEFAULTS[locale] ?? MAIL_BODY_DEFAULTS.de!).body };
}

/** Platzhalter aus einer festen Liste (Handoff 2b E5); unbekannte bleiben stehen. */
export function fillMailPlaceholders(body: string, values: Record<string, string>): string {
  return body.replace(/\{([A-Za-zÄÖÜäöü]+)\}/g, (match, name: string) => (name in values ? values[name]! : match));
}

/** Der Begleittext einer Sendung, als reiner Text. */
export function mailBodyFor(deps: Deps, doc: MailBodyDocument, recipient: MailBodyRecipient, db: DbOrTx = deps.db): string {
  const { body } = mailBodySnippetFor(deps, doc.typeKey, db);
  // Mailprogramme zeigen das PDF direkt unter dem Text; eine Leerzeile am Ende hält den Gruß frei (Joe 2026-10-18).
  const text = fillMailPlaceholders(body, {
    Anrede: recipient.salutation?.trim() ?? '',
    Name: recipient.name,
    Betreff: doc.subject,
    Datum: paperDate(isoDay(doc.documentDate)),
    Nummer: doc.number,
    Verein: readSetting<string>(deps, 'organization.name'),
  });
  return `${text.trimEnd()}\n\n`;
}
