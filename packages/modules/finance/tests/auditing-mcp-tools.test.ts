import { roleIdByOrigin, schema, type CallContext, type Result } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { FINANCE_MCP_TOOLS } from '../src/mcp-tools';
import { bookEntry } from '../src/ledger/finalize';
import { unwrap } from '@kompass/core';
import { auditFixture } from './auditing-fixture';
import { allowHumanOnlyOverMcp, pdfBytes } from './helpers';

/** Plan D1c, Task 2: die Schreibschritte der Kassenprüfung als Werkzeuge — ein Durchlauf wie mit den Seed-Schlüsseln. */

const NAMES = [
  'finance_audit_sample_set', 'finance_audit_section_review', 'finance_audit_section_unreview', 'finance_audit_remark_create',
  'finance_audit_remark_answer', 'finance_audit_remark_follow_up', 'finance_audit_remark_resolve',
  'finance_audit_report_draft_create', 'finance_audit_report_examination_save', 'finance_audit_report_result_save',
  'finance_audit_report_deviation_save', 'finance_audit_report_signatures_save', 'finance_audit_report_ready',
  'finance_audit_report_ready_revoke', 'finance_audit_auditor_end_access', 'finance_audit_confidentiality_file',
] as const;

const tool = (name: string) => {
  const found = FINANCE_MCP_TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
};

/** Wie der MCP-Adapter: erst das Werkzeugschema (das SDK parst die Argumente), dann der Handler. */
async function call<T = unknown>(deps: Parameters<ReturnType<typeof tool>['handler']>[0], ctx: CallContext, name: string, args: Record<string, unknown>): Promise<Result<T>> {
  const parsed = (tool(name).inputSchema as z.ZodType).parse(args);
  expect(parsed, `${name} keeps its arguments`).toEqual(args);
  return (await tool(name).handler(deps, ctx, parsed)) as Result<T>;
}

const code = (r: Result<unknown>) => (r.ok ? 'ok' : ((r.error as { code?: string }).code ?? r.error.type));

describe('Kassenprüfung — Werkzeuge (D1c)', () => {
  it('offers every write step as a human-only tool with its service', () => {
    for (const name of NAMES) {
      const t = tool(name);
      expect(t.service, name).toBeTypeOf('function');
      expect(t.description, name).toMatch(/Human only: refused over MCP unless the association has set finance\.mcpHumanOnlyAllowed at the screen\. Requires /);
    }
  });

  it('runs the audit over MCP with the switch: Mira audits, Anna answers and ends the access', async () => {
    const a = await auditFixture({ close: false });
    const { f, y2025, mira, miraAuditor } = a;
    const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2025-02-01', text: 'Rechnung Futter', moneyLines: [{ accountId: f.bank.id, amountCents: -4500 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -4500 }] }));
    f.closeYear(y2025);
    const miraMcp: CallContext = { ...mira.ctx, channel: 'mcp', apiTokenId: 'TOKEN-MIRA' };
    const annaMcp: CallContext = { ...f.ctx, channel: 'mcp', apiTokenId: 'TOKEN-ANNA' };

    // Ohne Schalter: abgelehnt.
    expect(code(await call(f.deps, miraMcp, 'finance_audit_sample_set', { fiscalYearId: y2025, entryId: entry.id, sampled: true }))).toBe('humanOnly');
    allowHumanOnlyOverMcp(f.deps);
    const logStart = f.deps.db.select().from(schema.auditLog).all().length;

    expect(unwrap(await call(f.deps, miraMcp, 'finance_audit_sample_set', { fiscalYearId: y2025, entryId: entry.id, sampled: true }))).toEqual({ entryId: entry.id, state: 'sampled' });
    expect(unwrap(await call(f.deps, miraMcp, 'finance_audit_section_review', { fiscalYearId: y2025, section: 'journal' }))).toEqual({ section: 'journal', reviewed: true });
    expect(unwrap(await call(f.deps, miraMcp, 'finance_audit_section_unreview', { fiscalYearId: y2025, section: 'journal' }))).toEqual({ section: 'journal', reviewed: false });
    unwrap(await call(f.deps, miraMcp, 'finance_audit_section_review', { fiscalYearId: y2025, section: 'vouchers' }));

    const remark = unwrap(await call<{ id: string; state: string }>(f.deps, miraMcp, 'finance_audit_remark_create', { fiscalYearId: y2025, kind: 'question', targetType: 'entry', targetId: entry.id, text: 'Wofür war das Futter?' }));
    expect(unwrap(await call<{ state: string }>(f.deps, annaMcp, 'finance_audit_remark_answer', { remarkId: remark.id, text: 'Für die Pflegestelle.' })).state).toBe('answered');
    expect(unwrap(await call<{ state: string }>(f.deps, miraMcp, 'finance_audit_remark_follow_up', { remarkId: remark.id, text: 'Beleg dazu?' })).state).toBe('open');
    expect(unwrap(await call<{ state: string }>(f.deps, miraMcp, 'finance_audit_remark_resolve', { remarkId: remark.id })).state).toBe('resolved');

    // Der Schatzmeister schreibt nie den eigenen Bericht — auch nicht über MCP.
    expect(code(await call(f.deps, annaMcp, 'finance_audit_report_draft_create', { fiscalYearId: y2025, kind: 'report' }))).toBe('auditorHasWriteRights');
    type Report = { id: string; state: string; examination: { version: string }; results: { version: string }[] };
    const draft = unwrap(await call<Report>(f.deps, miraMcp, 'finance_audit_report_draft_create', { fiscalYearId: y2025, kind: 'report' }));
    f.deps.clock.advance(1000);
    // Knapp (Befund MCP 8): Stand je Karte statt der ganzen Ansicht — den Inhalt liest finance_audit_report.
    type Compact = { reportId: string; state: string; versions: { examination: string; results: { auditorId: string | null; version: string }[]; deviations: { auditorId: string; version: string }[]; signatures: string }; lastEditedAt: string | null };
    const saved = unwrap(await call<Compact>(f.deps, miraMcp, 'finance_audit_report_examination_save', { reportId: draft.id, expectedVersion: draft.examination.version, dates: ['2026-02-18'], place: 'Vereinsheim' }));
    expect(Object.keys(saved).sort()).toEqual(['lastEditedAt', 'notices', 'openRemarks', 'reportId', 'state', 'versions']);
    expect(saved).toMatchObject({ reportId: draft.id, state: 'draft', versions: { examination: saved.lastEditedAt, results: [{ auditorId: null, version: draft.results[0]!.version }], deviations: [] } });
    // Zweiter Versuch mit altem Stand: Konflikt nur für diese Karte.
    expect(code(await call(f.deps, miraMcp, 'finance_audit_report_examination_save', { reportId: draft.id, expectedVersion: draft.examination.version, dates: ['2026-02-19'] }))).toBe('staleVersion');
    unwrap(await call(f.deps, miraMcp, 'finance_audit_report_result_save', { reportId: draft.id, expectedVersion: draft.results[0]!.version, result: 'clean', recommendation: 'discharge' }));
    const dev = unwrap(await call<Compact>(f.deps, miraMcp, 'finance_audit_report_deviation_save', { reportId: draft.id, text: 'Keine.' }));
    const mine = dev.versions.deviations.find((d) => d.auditorId === miraAuditor.id)!;
    f.deps.clock.advance(1000);
    unwrap(await call(f.deps, miraMcp, 'finance_audit_report_deviation_save', { reportId: draft.id, expectedVersion: mine.version, text: 'Doch eine.' }));
    expect(code(await call(f.deps, miraMcp, 'finance_audit_report_deviation_save', { reportId: draft.id, expectedVersion: mine.version, text: 'Alt.' }))).toBe('staleVersion');
    unwrap(await call(f.deps, miraMcp, 'finance_audit_report_signatures_save', { reportId: draft.id, mode: 'both' }));
    expect(unwrap(await call<Report>(f.deps, miraMcp, 'finance_audit_report_ready', { reportId: draft.id })).state).toBe('readyToSign');
    expect(unwrap(await call<Report>(f.deps, miraMcp, 'finance_audit_report_ready_revoke', { reportId: draft.id })).state).toBe('draft');
    expect(unwrap(await call<Report>(f.deps, miraMcp, 'finance_audit_report_ready', { reportId: draft.id })).state).toBe('readyToSign');

    // Anna legt die Vertraulichkeitserklärung ab (Base64) und beendet Miras Zugang.
    const filed = unwrap(await call<{ confidentialityDocumentId: string | null }>(f.deps, annaMcp, 'finance_audit_confidentiality_file', { auditorId: miraAuditor.id, contentBase64: Buffer.from(pdfBytes()).toString('base64'), fileName: 'erklaerung.pdf' }));
    expect(filed.confidentialityDocumentId).not.toBeNull();
    expect(code(await call(f.deps, annaMcp, 'finance_audit_confidentiality_file', { auditorId: miraAuditor.id, contentBase64: '***' }))).toBe('validation');
    // Mira kann sich den Zugang nicht selbst beenden (und damit nichts geben).
    expect(code(await call(f.deps, miraMcp, 'finance_audit_auditor_end_access', { id: miraAuditor.id }))).toBe('forbidden');
    const otherRole = roleIdByOrigin(f.deps.db, 'finance:approver')!;
    f.deps.db.insert(schema.userRoles).values({ userId: mira.userId, roleId: otherRole }).run();
    unwrap(await call(f.deps, annaMcp, 'finance_audit_auditor_end_access', { id: miraAuditor.id }));
    const roles = f.deps.db.select().from(schema.userRoles).where(eq(schema.userRoles.userId, mira.userId)).all().map((r) => r.roleId);
    // Nur die Prüferrolle geht, jede andere bleibt.
    expect(roles).toEqual([otherRole]);

    const viaMcp = f.deps.db.select().from(schema.auditLog).all().slice(logStart).filter((e) => e.action.startsWith('finance.audit.'));
    expect(viaMcp.length).toBeGreaterThan(15);
    expect(viaMcp.every((e) => e.channel === 'mcp' && (e.apiTokenId === 'TOKEN-MIRA' || e.apiTokenId === 'TOKEN-ANNA'))).toBe(true);
  });
});
