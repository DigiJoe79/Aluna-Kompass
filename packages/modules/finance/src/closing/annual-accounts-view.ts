import { definePublishedView, systemContext, timeZoneOf, type Deps, type PublishedFileSource } from '@kompass/core';
import { readLinkedDocument } from '@kompass/module-dms';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { financeAnnualAccountsPublications, financeFiscalYears, financeReports, financeReportSignatures } from '../schema';
import { annualAccountsHref } from './annual-accounts-publish';
import { zonedDayOf } from '../zoned-days';

/** Präfix der Datei-IDs der Jahresrechnung in der Sicht (`pdfAssetId`) und im Haken `publishedFile`. */
export const ANNUAL_ACCOUNTS_FILE_PREFIX = 'finance.annualAccounts.';

interface LiveAnnualAccounts {
  fiscalYearId: string;
  designation: string;
  endsOn: string;
  reportId: string;
  finalizedAt: string;
  documentId: string;
  documentNumber: string;
  corrected: boolean;
  replacesFinalizedAt: string | null;
  webVersionOn: string | null;
}

/**
 * Je Jahr höchstens eine: die jüngste laufende Veröffentlichung einer **nicht stornierten** Fassung (Spec: Die Sicht
 * liefert nur festgeschriebene, nicht stornierte Fassungen). Das Dokument ist die Webfassung, sonst die abgezeichnete.
 */
export function liveAnnualAccountsInternal(deps: Deps): LiveAnnualAccounts[] {
  const rows = deps.db
    .select({ pub: financeAnnualAccountsPublications, report: financeReports, year: financeFiscalYears, signature: financeReportSignatures })
    .from(financeAnnualAccountsPublications)
    .innerJoin(financeReports, eq(financeReports.id, financeAnnualAccountsPublications.reportId))
    .innerJoin(financeFiscalYears, eq(financeFiscalYears.id, financeAnnualAccountsPublications.fiscalYearId))
    .innerJoin(financeReportSignatures, eq(financeReportSignatures.reportId, financeReports.id))
    .where(and(isNull(financeAnnualAccountsPublications.withdrawnAt), isNull(financeReports.voidedAt)))
    .orderBy(desc(financeAnnualAccountsPublications.publishedAt))
    .all();
  const byYear = new Map<string, LiveAnnualAccounts>();
  for (const { pub, report, year, signature } of rows) {
    if (byYear.has(year.id)) continue;
    byYear.set(year.id, {
      fiscalYearId: year.id,
      designation: year.designation,
      endsOn: year.endsOn,
      reportId: report.id,
      finalizedAt: report.finalizedAt,
      documentId: pub.webDocumentId ?? signature.documentId,
      documentNumber: pub.webDocumentNumber ?? signature.documentNumber,
      corrected: pub.corrected,
      replacesFinalizedAt: pub.replacesFinalizedAt,
      webVersionOn: pub.webVersionOn,
    });
  }
  return [...byYear.values()].sort((a, b) => b.endsOn.localeCompare(a.endsOn));
}

/**
 * Sicht `annualAccounts` für Vorlagen (`uses: ['finance']`): je veröffentlichter Jahresrechnung Jahr, Papiertitel (deutsch
 * wie das PDF), Tag der Festschreibung in der Zone des Vereins und die PDF-Datei — keine Namen, keine Beträge. Die
 * Vorlage setzt den Link selbst; sichtbar wird eine Änderung mit dem nächsten Publizieren.
 */
export const publishedAnnualAccounts = definePublishedView({
  name: 'annualAccounts',
  schema: z.object({
    year: z.string(),
    title: z.string(),
    finalizedOn: z.string(),
    pdfAssetId: z.string(),
    corrected: z.boolean(),
    replacesFinalizedOn: z.string().nullable(),
    webVersionOn: z.string().nullable(),
  }),
  load: (deps) => {
    const tz = timeZoneOf(deps);
    return liveAnnualAccountsInternal(deps).map((r) => ({
      year: r.designation,
      title: `Jahresrechnung ${r.designation}`,
      finalizedOn: zonedDayOf(r.finalizedAt, tz),
      pdfAssetId: `${ANNUAL_ACCOUNTS_FILE_PREFIX}${r.documentId}`,
      corrected: r.corrected,
      replacesFinalizedOn: r.replacesFinalizedAt ? zonedDayOf(r.replacesFinalizedAt, tz) : null,
      webVersionOn: r.webVersionOn,
    }));
  },
  editLink: (deps, row) => {
    const year = deps.db.select({ id: financeFiscalYears.id }).from(financeFiscalYears).where(eq(financeFiscalYears.designation, row.year)).get();
    return year ? { href: annualAccountsHref(year.id), title: row.title } : null;
  },
});

const fileNameOf = (designation: string, documentNumber: string) =>
  `${`jahresrechnung-${designation}-${documentNumber}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')}.pdf`;

/**
 * Haken `publishedFile`: die PDF-Datei einer laufenden Veröffentlichung — nur Dokumente, die die Sicht nennt (nie die
 * festgeschriebene Fassung, nie der Scan). Gelesen wird ohne Rechte des Aufrufers über den Bezug der Fassung: Die
 * Datei ist durch die Veröffentlichung öffentlich.
 */
export function annualAccountsPublishedFile(deps: Deps, id: string): PublishedFileSource | null {
  if (!id.startsWith(ANNUAL_ACCOUNTS_FILE_PREFIX)) return null;
  const documentId = id.slice(ANNUAL_ACCOUNTS_FILE_PREFIX.length);
  const live = liveAnnualAccountsInternal(deps).find((r) => r.documentId === documentId);
  if (!live) return null;
  return {
    id,
    filename: fileNameOf(live.designation, live.documentNumber),
    mimeType: 'application/pdf',
    read: async () => {
      const file = await readLinkedDocument(deps, systemContext({ permissions: ['finance.read'] }), { documentId, entityType: 'financeReport', entityId: live.reportId });
      if (!file.ok) throw new Error(`Jahresrechnung ${live.documentNumber}: Datei nicht lesbar (${file.error.type})`);
      return file.value.bytes;
    },
  };
}
