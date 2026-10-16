import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SETTINGS_TABS } from '@/lib/settings-fields';
import { checkCountedAllowlist, type CountedAllowlist, isCommentLine, read, relative, sourceFiles, SRC } from './source';

/**
 * Monospace nur für Kennungen (Durchsicht 0.2.11, Auftrag 5; Joe 2026-10-16): Belegnummern, technische Schlüssel,
 * Codes, Passwörter, Token, Tastenkürzel — und die IBAN, die man Zeichen für Zeichen vergleicht und abtippt.
 * Beträge, Datum, Uhrzeit, Zähler, Telefon, E-Mail, Textfelder, Titel und Dateinamen stehen in der Textschrift; wo
 * Zahlen untereinander stehen, mit `tabular-nums`. Bis 0.2.11 stand `font-mono` in 266 Zeilen, Beträge eingeschlossen.
 *
 * Zuhause von `font-mono`: `KeyLine` und `KeyChip`. Jede andere Stelle steht unten mit Zahl und Grund. Gezählt wird
 * jedes Vorkommen, nicht jede Zeile.
 */
const MONO = /(?<![\w-])font-mono(?![\w-])/g;
const HOMES = new Set(['components/key-line.tsx', 'components/key-chip.tsx']);

const NUMBER = 'Belegnummer, Dokument- oder Vorgangsnummer (Kennung).';
const KEY = 'Technischer Schlüssel oder Code (Kennung).';
const IBAN = 'IBAN — Kennung, Zeichen für Zeichen verglichen (Joe 2026-10-16, Abweichung von Auftrag 5).';
const SLUG = 'Slug/Adresskürzel — technischer Schlüssel in der URL.';
const LOCALE = 'Sprachcode (Kennung).';
const STATUS = 'HTTP-Code bzw. Fehlerkennung (digest) der Fehlerseite.';
const LOG = 'Protokollausgabe/Pfad aus dem Webseitenbau — technischer Text, Zeichen für Zeichen.';
const SHORTCUT = 'Tastenkürzel (MUSTER § Schrift).';

const ALLOWED: CountedAllowlist = {
  'app/error.tsx': { count: 2, reason: STATUS },
  'app/(shell)/error.tsx': { count: 2, reason: STATUS },
  'app/(shell)/not-found.tsx': { count: 1, reason: STATUS },
  'components/forbidden-card.tsx': { count: 2, reason: `${STATUS} Dazu der Schlüssel des fehlenden Rechts.` },
  'app/setup/setup-form.tsx': { count: 1, reason: LOCALE },
  'app/setup/import/import-form.tsx': { count: 1, reason: 'Umgebungsname des Backups (`production`, …) — Schlüssel.' },
  'app/(shell)/admin/locales/locales-client.tsx': { count: 2, reason: LOCALE },
  'components/forms/localized-field.tsx': { count: 3, reason: `${LOCALE} \`LOCALE_CODE\`, Umschalter der Vorschau.` },
  'components/schema-form/field.tsx': { count: 1, reason: `${LOCALE} Umschalter der Sprachen.` },
  'app/(shell)/admin/dms/text-panel.tsx': { count: 2, reason: 'Sprachcodes der Texterkennung (`deu`, `eng`) — Kennung.' },
  'app/(shell)/admin/settings/settings-form.tsx': { count: 1, reason: "Feldart `kind: 'mono'` — nur Kennungen, siehe Test unten." },
  'app/(shell)/admin/audit/audit-detail.tsx': {
    count: 5,
    reason: 'Rohwerte vorher/nachher, IP-Adresse, Request-ID, Aktionsschlüssel, Entität und ID — technische Angaben des Protokolls.',
  },
  'app/(shell)/admin/backup/import-card.tsx': { count: 2, reason: 'Bestätigungswort, das man Zeichen für Zeichen abtippt, und seine Vorlage.' },
  'app/(shell)/admin/dms/dispatch-channels-panel.tsx': { count: 2, reason: `${KEY} Schlüssel des Versandwegs.` },
  'app/(shell)/admin/dms/rules-panel.tsx': { count: 1, reason: 'Suchtext der Regel, der wörtlich (mit Leerzeichen) verglichen wird.' },
  'app/(shell)/admin/dms/types-panel.tsx': { count: 3, reason: `${KEY} Kürzel des Nummernkreises und Schlüssel der Dokumentart.` },
  'app/(shell)/admin/documents/bases-panel.tsx': { count: 2, reason: `${KEY} Kennung der Dokument-Basis.` },
  'app/(shell)/admin/finance/accounts-panel.tsx': { count: 1, reason: IBAN },
  'app/(shell)/admin/site/connection-card.tsx': { count: 1, reason: LOG },
  'app/(shell)/admin/themes/theme-editor.tsx': { count: 2, reason: `${KEY} Name des Theme-Tokens und sein Farbwert.` },
  'app/(shell)/admin/users/start-password-dialog.tsx': { count: 2, reason: 'Startpasswort — wird abgetippt.' },
  'app/(shell)/profile/api-tokens.tsx': { count: 1, reason: 'API-Token im Klartext — wird kopiert.' },
  'app/(shell)/animals/animal-fields.tsx': { count: 1, reason: SLUG },
  'app/(shell)/projects/project-form.tsx': { count: 1, reason: SLUG },
  'app/(shell)/site/c/[collection]/entry-form.tsx': { count: 1, reason: SLUG },
  'app/(shell)/site/publish/blocked-notice.tsx': { count: 1, reason: LOG },
  'app/(shell)/site/publish/file-list.tsx': { count: 1, reason: LOG },
  'app/(shell)/site/publish/log-dialog.tsx': { count: 2, reason: `${LOG} Dazu der Hash des Stands.` },
  'app/(shell)/site/publish/preview-details.tsx': { count: 2, reason: LOG },
  'app/(shell)/dms/[id]/document-detail.tsx': { count: 2, reason: NUMBER },
  'app/(shell)/dms/[id]/page.tsx': { count: 1, reason: NUMBER },
  'app/(shell)/dms/document-list.tsx': { count: 1, reason: NUMBER },
  'app/(shell)/dms/receive/number-hint.tsx': { count: 1, reason: NUMBER },
  'app/(shell)/dms/receive/file-dropzone.tsx': { count: 1, reason: 'Dateiart (`PDF`) als Kürzel im Dateisymbol.' },
  'components/drop-overlay.tsx': { count: 1, reason: 'Dateiart (`PDF`) als Kürzel im Dateisymbol.' },
  'components/related-documents.tsx': { count: 1, reason: NUMBER },
  'app/(shell)/finance/approvals/approval-queue.tsx': { count: 1, reason: NUMBER },
  'app/(shell)/finance/approvals/page.tsx': { count: 1, reason: NUMBER },
  'app/(shell)/finance/approvals/partner-payment-detail.tsx': { count: 1, reason: NUMBER },
  'app/(shell)/finance/approvals/purpose-transfer-detail.tsx': { count: 1, reason: NUMBER },
  'components/finance/approval-detail-frame.tsx': { count: 1, reason: NUMBER },
  'app/(shell)/finance/donations/book/book-table.tsx': { count: 1, reason: NUMBER },
  'app/(shell)/finance/donations/confirmations-table.tsx': { count: 2, reason: NUMBER },
  'app/(shell)/finance/donations/notices/notice-dialog.tsx': { count: 2, reason: `${NUMBER} Dazu die Steuernummer (offen, siehe lauf-0.2.12-offen.md).` },
  'app/(shell)/finance/donations/notices/notices-table.tsx': { count: 2, reason: `${NUMBER} Dazu die Steuernummer (offen, siehe lauf-0.2.12-offen.md).` },
  'app/(shell)/finance/donations/run/run-selection.tsx': { count: 1, reason: `${NUMBER} Nummernbereich des Laufs.` },
  'app/(shell)/finance/donations/signature-steps.tsx': { count: 1, reason: NUMBER },
  'app/(shell)/finance/donations/uncertified-list.tsx': { count: 1, reason: NUMBER },
  'app/(shell)/finance/entries/entry-form.tsx': { count: 1, reason: NUMBER },
  'app/(shell)/finance/entries/journal.tsx': { count: 1, reason: NUMBER },
  'app/(shell)/finance/expenses/claims-list.tsx': { count: 1, reason: NUMBER },
  'app/(shell)/finance/expenses/new/expense-form.tsx': { count: 1, reason: IBAN },
  'app/(shell)/finance/imports/format/csv-assistant.tsx': {
    count: 2,
    reason: `${IBAN} Dazu die Rohzellen der CSV-Vorschau, wie sie in der Datei stehen (offen, siehe lauf-0.2.12-offen.md).`,
  },
  'app/(shell)/finance/partners/[id]/partner-detail.tsx': { count: 2, reason: NUMBER },
  'app/(shell)/finance/partners/[id]/payments/[paymentId]/draft-form.tsx': { count: 1, reason: `${NUMBER} Nur das Nummern-Span einer gemischten Zeile.` },
  'app/(shell)/finance/partners/[id]/payments/[paymentId]/payment-detail.tsx': { count: 1, reason: `${NUMBER} Nur, wenn es eine Nummer gibt.` },
  'app/(shell)/finance/purposes/purpose-detail.tsx': { count: 1, reason: NUMBER },
  'app/(shell)/finance/purposes/transfer/transfer-form.tsx': { count: 1, reason: NUMBER },
  'app/(shell)/finance/reserves/reserve-table.tsx': { count: 1, reason: NUMBER },
  'app/(shell)/finance/work/foreign/page.tsx': { count: 1, reason: NUMBER },
  'app/(shell)/finance/work/voucher-panel.tsx': { count: 1, reason: `${NUMBER} Nur das Nummern-Span einer gemischten Zeile.` },
  'app/(shell)/finance/work/vouchers/voucher-rows.tsx': { count: 1, reason: NUMBER },
  'app/(shell)/finance/work/work-detail.tsx': { count: 1, reason: `${IBAN} Dazu Bankreferenz, End-to-End-ID und Bezugsreferenz des Umsatzes.` },
  'components/finance/account-card.tsx': { count: 1, reason: IBAN },
  'components/finance/invoice-card.tsx': { count: 2, reason: `${NUMBER} Dazu die IBAN des Zahlungsempfängers (${IBAN})` },
  'components/finance/receipt-list.tsx': { count: 1, reason: NUMBER },
  'components/media/crop-editor.tsx': {
    count: 2,
    reason: 'Rolle `text-key` (Pixelmaß und Tastenhinweis); die Rolle trägt Mono (offen, siehe lauf-0.2.12-offen.md).',
  },
  'components/shell/topbar.tsx': { count: 1, reason: SHORTCUT },
  'components/ui/command.tsx': { count: 1, reason: SHORTCUT },
  'components/ui/dropdown-menu.tsx': { count: 1, reason: SHORTCUT },
};

const files = () => [path.join(SRC, 'app'), path.join(SRC, 'components'), path.join(SRC, 'lib')].flatMap((dir) => sourceFiles(dir));

describe('Monospace nur für Kennungen', () => {
  const hits = files()
    .filter((file) => !HOMES.has(relative(file)))
    .flatMap((file) =>
      read(file)
        .split('\n')
        .flatMap((line, index) => (isCommentLine(line) ? [] : [...line.matchAll(MONO)].map(() => ({ where: `${relative(file)}:${index + 1}`, file: relative(file) })))),
    );

  it('font-mono nur in KeyLine, KeyChip und an Kennungen mit Grund', () => {
    expect(checkCountedAllowlist(hits, ALLOWED).unexpected).toEqual([]);
  });

  it('jede Ausnahme ist noch nötig', () => {
    expect(checkCountedAllowlist(hits, ALLOWED).stale).toEqual([]);
  });

  it('keine Schriftfamilie inline, außer der Fehlerseite ohne Theme', () => {
    const inline = files()
      .filter((file) => relative(file) !== 'app/global-error.tsx')
      .flatMap((file) => read(file).split('\n').flatMap((line, index) => (!isCommentLine(line) && /\bfontFamily\s*:/.test(line) ? [`${relative(file)}:${index + 1}`] : [])));
    expect(inline).toEqual([]);
  });

  it("Feldart 'mono' der Einstellungen nur für Kennungen", () => {
    const mono = SETTINGS_TABS.flatMap((tab) => tab.fields.filter((field) => field.kind === 'mono').map((field) => field.key));
    expect(mono.sort()).toEqual(['organization.bic', 'organization.iban', 'organization.taxNumber']);
  });
});
