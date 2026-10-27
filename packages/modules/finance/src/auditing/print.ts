import { buildContext, EMPTY, hasPermission, isoNow, notFound, ok, paperDate, prepare, readSetting, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { formatAmount } from '../format/amount';
import { financeConflict } from '../errors';
import { reportDefinition } from '../reporting/catalog';
import { financeAuditReportDeviations, financeAuditReports, financeFiscalYears, financeEntries } from '../schema';
import { auditorsOfYearInternal, isReportEditorInternal } from './access';
import { baselineShortHashInternal } from './baseline';
import { createReportInternal, currentReportInternal, followUpOpenInternal, loadReport, reportCreatableInternal, reportViewInternal, subjectSnapshotInternal, type AuditReportView } from './report';
import { AUDIT_REPORT_PRINT_TEMPLATE_KEY, type AuditReportPrintInput } from './report-template';

/**
 * Prüfbericht drucken (Spec § D1 Schritt 6) und den Vordruck für Papier-Prüfer (12e B, 12g). Über `prepare` +
 * `buildContext` + `deps.documents.render` — kein Dokument, keine Nummer; gültig ist der abgelegte Scan (`filing.ts`).
 * Liefert Bytes: kein MCP-Werkzeug.
 */

const day = (iso: string) => paperDate(iso.slice(0, 10) as never);

export function printInputInternal(deps: Deps, view: AuditReportView, blank: boolean): AuditReportPrintInput {
  const db: DbOrTx = deps.db;
  const auditorRows = new Map(auditorsOfYearInternal(db, view.fiscalYearId).map((a) => [a.id, a]));
  const nameOf = (id: string) => view.auditors.find((a) => a.id === id)?.contactName ?? '';
  const subject: AuditReportPrintInput['subject'] = [
    { label: 'Verein', value: String(readSetting<string>(deps, 'organization.name') ?? '') },
    { label: 'Geschäftsjahr', value: `${view.subject.designation} (${day(view.subject.startsOn)}–${day(view.subject.endsOn)})` },
    { label: 'Prüffassung vom', value: day(view.subject.baseline.createdAt) },
  ];
  if (view.kind === 'report') subject.push({ label: 'Geprüfte Berichte', value: view.subject.reports.map((r) => `${reportDefinition(r.key)?.paperTitle ?? r.key} (${r.shortHash})`).join(', ') || EMPTY });
  if (!blank || view.subject.samples.sampledEntries > 0) subject.push({ label: 'Umfang', value: `Stichproben: ${view.subject.samples.sampledEntries} von ${view.subject.samples.totalEntries} Buchungen · Durchgesehen: ${view.subject.sectionsReviewed.reviewed} von ${view.subject.sectionsReviewed.total} Abschnitten` });
  const cash = view.subject.cash;
  subject.push({ label: 'Kassenbestand', value: cash ? `${formatAmount(cash.countedCents)} € am ${day(cash.countedOn)}, gezählt im Beisein von ${cash.witnessAuditorIds.map(nameOf).join(' und ')}` : 'am Prüfungstag nicht gezählt' });
  subject.push({
    label: 'Prüfer',
    value: view.auditors.map((a) => {
      const row = auditorRows.get(a.id);
      return [a.contactName, a.mode === 'paper' ? 'auf Papier' : null, row?.electedOn ? `gewählt in der MV am ${day(row.electedOn)}` : null].filter(Boolean).join(', ');
    }).join('; ') || EMPTY,
  });

  const changed = view.kind === 'followUp'
    ? view.subject.changedEntryIds.map((id) => db.select({ number: financeEntries.number }).from(financeEntries).where(eq(financeEntries.id, id)).get()?.number ?? '').filter(Boolean)
    : null;
  const deviations = db.select().from(financeAuditReportDeviations).where(eq(financeAuditReportDeviations.reportId, view.id)).all();
  const deviationOf = (auditorId: string) => (blank || auditorRows.get(auditorId)?.mode === 'paper' ? null : (deviations.find((d) => d.auditorId === auditorId)?.text ?? ''));
  const signatureOf = (auditorId: string) => ({ name: nameOf(auditorId), notSignedReason: view.signatures.mode === 'one' && view.signatures.nonSignerAuditorId === auditorId ? (view.signatures.nonSignerReason ?? '') : null });

  const parts: AuditReportPrintInput['parts'] = view.signatures.mode === 'separate'
    ? view.auditors.map((a) => {
        const own = view.results.find((r) => r.auditorId === a.id);
        const paper = blank || a.mode === 'paper';
        return { heading: a.contactName, result: paper ? null : (own?.result ?? null), recommendation: paper ? null : (own?.recommendation ?? 'none'), deviations: [{ name: a.contactName, text: deviationOf(a.id) }], signatures: [signatureOf(a.id)] };
      })
    : [{
        heading: null,
        result: blank ? null : (view.results[0]?.result ?? null),
        recommendation: blank ? null : (view.results[0]?.recommendation ?? 'none'),
        deviations: view.auditors.map((a) => ({ name: a.contactName, text: deviationOf(a.id) })),
        signatures: view.auditors.length ? view.auditors.map((a) => signatureOf(a.id)) : [{ name: '', notSignedReason: null }, { name: '', notSignedReason: null }],
      }];

  return {
    title: view.kind === 'followUp' ? `Nachtrag zum Prüfbericht ${view.subject.designation}` : `Prüfbericht ${view.subject.designation}`,
    subtitle: 'Bericht der Kassenprüfer an die Mitgliederversammlung',
    draft: view.state === 'draft',
    footerNote: `Prüfstand vom ${day(view.subject.baseline.createdAt)} · ${baselineShortHashInternal(db, view.subject.baseline.id)}`,
    subject,
    changed,
    examination: blank ? null : { dates: view.examination.dates.map((d) => day(d)).join(', ') || EMPTY, place: view.examination.place ?? EMPTY, notTested: view.examination.notTested ?? 'Keine Einschränkungen' },
    findings: blank ? [] : view.findings.map((f) => f.text),
    openQuestions: blank ? [] : view.openQuestions.map((q) => q.text),
    blankRemarks: blank,
    parts,
  };
}

async function renderInternal(deps: Deps, ctx: CallContext, input: AuditReportPrintInput): Promise<Result<Uint8Array>> {
  const prepared = await prepare(deps, ctx, { templateKey: AUDIT_REPORT_PRINT_TEMPLATE_KEY, input }, { number: '' });
  if (!prepared.ok) return prepared;
  const { built, baseId, bodyTypst, images } = prepared.value;
  const context = await buildContext(deps, ctx, '');
  const { bytes } = await deps.documents.render({ baseId, bodyTypst, slots: built.slots, context, images });
  return ok(bytes);
}

function markPrinted(tx: DbOrTx, deps: Deps, ctx: CallContext, view: AuditReportView, blank: boolean): void {
  tx.update(financeAuditReports).set({ lastPrintedAt: isoNow(deps.clock) }).where(eq(financeAuditReports.id, view.id)).run();
  financeAudit(tx, deps, ctx, { action: 'finance.audit.report.print', entity: 'financeAuditReport', id: view.id, after: { fiscalYearId: view.fiscalYearId, kind: view.kind, origin: view.origin, state: view.state }, params: { designation: view.subject.designation, kind: view.kind, blank } });
}

const fileName = (view: AuditReportView) => `${view.kind === 'followUp' ? 'Nachtrag-Pruefbericht' : 'Pruefbericht'}-${view.subject.designation}${view.state === 'draft' ? '-Entwurf' : ''}.pdf`;

const printSchema = z.object({ reportId: z.string().min(1) });

/**
 * Bearbeiter oder `finance.periodClose`: den Bericht drucken — im Entwurf mit ENTWURF-Stempel („Druckansicht“, 12d),
 * ab „zum Unterschreiben“ ohne. Protokolliert (`finance.audit.report.print`).
 */
export async function printAuditReport(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ bytes: Uint8Array; filename: string; reportId: string }>> {
  if (!hasPermission(ctx, 'finance.audit') && !hasPermission(ctx, 'finance.periodClose')) return requirePermission(ctx, 'finance.periodClose')!;
  const parsed = validate(deps, printSchema, input);
  if (!parsed.ok) return parsed;
  const row = loadReport(deps.db, parsed.value.reportId);
  if (!row) return notFound('financeAuditReport', parsed.value.reportId);
  const year = deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, row.fiscalYearId)).get()!;
  if (!hasPermission(ctx, 'finance.periodClose') && !isReportEditorInternal(deps.db, ctx, row.fiscalYearId)) return financeConflict('auditorRequired', { designation: year.designation });
  const view = reportViewInternal(deps, ctx, row);
  const blank = row.origin === 'blank';
  const bytes = await renderInternal(deps, ctx, printInputInternal(deps, view, blank));
  if (!bytes.ok) return bytes;
  deps.db.transaction((tx: DbOrTx) => markPrinted(tx, deps, ctx, view, blank));
  return ok({ bytes: bytes.value, filename: fileName(view), reportId: row.id });
}

const blankSchema = z.object({ fiscalYearId: z.string().min(1), kind: z.enum(['report', 'followUp']).optional() });

/**
 * `finance.periodClose`, nur wenn niemand in Kompass prüft: den Vordruck drucken. Beim ersten Aufruf entsteht ein
 * Bericht `origin: blank` im Zustand „zum Unterschreiben“ (bei offener Nachprüfung der Nachtrag); Kompass setzt
 * Gegenstand, Umfang und Kassenbestand mit Zeugen ein, der Rest sind leere Zeilen, beim Ergebnis zwei Kästchen.
 */
export async function printAuditReportBlank(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ bytes: Uint8Array; filename: string; reportId: string }>> {
  const denied = requirePermission(ctx, 'finance.periodClose');
  if (denied) return denied;
  const parsed = validate(deps, blankSchema, input);
  if (!parsed.ok) return parsed;
  const year = deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, parsed.value.fiscalYearId)).get();
  if (!year) return notFound('financeFiscalYear', parsed.value.fiscalYearId);
  if (auditorsOfYearInternal(deps.db, year.id).some((a) => a.mode === 'kompass')) return financeConflict('auditBlankKompassAuditor', { designation: year.designation });
  const kind = parsed.value.kind ?? (followUpOpenInternal(deps.db, year.id) ? 'followUp' : 'report');
  const existing = kind === 'report' ? currentReportInternal(deps.db, year.id, 'report') : (() => {
    const latest = currentReportInternal(deps.db, year.id, 'followUp');
    return latest && latest.state !== 'filed' ? latest : null;
  })();
  if (existing && existing.origin !== 'blank') return financeConflict('auditReportExists', { designation: year.designation });
  if (existing?.state === 'filed') return financeConflict('auditReportFiled', { designation: year.designation });
  if (!existing) {
    const blocked = reportCreatableInternal(deps.db, year, kind);
    if (blocked) return financeConflict(blocked, { designation: year.designation });
  }
  const created = existing ?? deps.db.transaction((tx: DbOrTx) => createReportInternal(tx, deps, ctx, year, kind, 'blank'));
  // Der Vordruck ist von Anfang an „zum Unterschreiben“: Sein Gegenstand steht mit dem ersten Druck fest, damit das
  // unterschriebene Papier und der Bericht in Kompass dasselbe sagen (Schlussdurchsicht D1d, I-2).
  if (!created.subjectSnapshot) deps.db.update(financeAuditReports).set({ subjectSnapshot: subjectSnapshotInternal(deps, created) }).where(eq(financeAuditReports.id, created.id)).run();
  const row = loadReport(deps.db, created.id)!;
  const view = reportViewInternal(deps, ctx, row);
  const bytes = await renderInternal(deps, ctx, printInputInternal(deps, view, true));
  if (!bytes.ok) return bytes;
  deps.db.transaction((tx: DbOrTx) => markPrinted(tx, deps, ctx, view, true));
  return ok({ bytes: bytes.value, filename: `Vordruck-${fileName(view)}`, reportId: row.id });
}
