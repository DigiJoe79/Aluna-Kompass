import { schema, unwrap, type CallContext, type Result } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { documents } from '@kompass/module-dms';
import { describe, expect, it } from 'vitest';
import { endAuditorAccess, fileConfidentialityDeclaration } from '../src/auditing/auditors';
import { answerAuditRemark, createAuditRemark, followUpAuditRemark, resolveAuditRemark } from '../src/auditing/remarks';
import {
  createAuditReportDraft, markAuditReportReadyToSign, revokeAuditReportReadyToSign, saveAuditReportDeviation, saveAuditReportExamination, saveAuditReportResult, saveAuditReportSignatures,
} from '../src/auditing/report';
import { markSectionReviewed, setSample, unmarkSectionReviewed } from '../src/auditing/samples';
import { bookEntry } from '../src/ledger/finalize';
import {
  financeAuditAuditors, financeAuditRemarkPosts, financeAuditRemarks, financeAuditReportDeviations, financeAuditReportResults, financeAuditReports, financeAuditSamples, financeAuditSectionReviews,
} from '../src/schema';
import { auditFixture } from './auditing-fixture';
import { allowHumanOnlyOverMcp, pdfBytes } from './helpers';

/**
 * Plan D1c, Task 1: Jeder Schreibschritt der Kassenprüfung ist ein persönlicher Schritt (`humanOnly`) — über MCP
 * abgelehnt, solange der Verein `finance.mcpHumanOnlyAllowed` nicht setzt, und dann ohne jede Spur; mit dem Schalter
 * derselbe Dienst mit Protokoll über Kanal `mcp`. Ohne Recht bleibt es `forbidden`, nicht `humanOnly`.
 */

type Fixture = Awaited<ReturnType<typeof setup>>;
type Service = (deps: Fixture['f']['deps'], ctx: CallContext, input: unknown) => Promise<Result<unknown>>;

async function setup() {
  const a = await auditFixture({ close: false });
  const { f } = a;
  const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2025-02-01', text: 'Rechnung Futter', moneyLines: [{ accountId: f.bank.id, amountCents: -4500 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -4500 }] }));
  f.closeYear(a.y2025);
  const remark = async () => unwrap(await createAuditRemark(f.deps, a.mira.ctx, { fiscalYearId: a.y2025, kind: 'question', targetType: 'entry', targetId: entry.id, text: 'Wofür?' }));
  const draft = async () => unwrap(await createAuditReportDraft(f.deps, a.mira.ctx, { fiscalYearId: a.y2025, kind: 'report' }));
  const ready = async () => {
    const d = await draft();
    unwrap(await saveAuditReportExamination(f.deps, a.mira.ctx, { reportId: d.id, expectedVersion: d.examination.version, dates: ['2026-02-18'] }));
    unwrap(await saveAuditReportResult(f.deps, a.mira.ctx, { reportId: d.id, result: 'clean', recommendation: 'discharge' }));
    return d;
  };
  return { ...a, entry, remark, draft, ready };
}

/** Alles, was ein Schreibschritt der Prüfung berühren kann — samt Protokoll, Rollen und Akte. */
function snapshot(f: Fixture['f']): string {
  const db = f.deps.db;
  const tables = [schema.auditLog, schema.userRoles, documents, financeAuditAuditors, financeAuditSamples, financeAuditSectionReviews, financeAuditRemarks, financeAuditRemarkPosts, financeAuditReports, financeAuditReportResults, financeAuditReportDeviations];
  return JSON.stringify(tables.map((t) => db.select().from(t).all()));
}

const cases: { name: string; service: Service; by: 'mira' | 'anna'; prepare: (a: Fixture) => Promise<Record<string, unknown>> }[] = [
  { name: 'setSample', service: setSample, by: 'mira', prepare: async (a) => ({ fiscalYearId: a.y2025, entryId: a.entry.id, sampled: true }) },
  { name: 'markSectionReviewed', service: markSectionReviewed, by: 'mira', prepare: async (a) => ({ fiscalYearId: a.y2025, section: 'journal' }) },
  {
    name: 'unmarkSectionReviewed', service: unmarkSectionReviewed, by: 'mira',
    prepare: async (a) => { unwrap(await markSectionReviewed(a.f.deps, a.mira.ctx, { fiscalYearId: a.y2025, section: 'journal' })); return { fiscalYearId: a.y2025, section: 'journal' }; },
  },
  { name: 'createAuditRemark', service: createAuditRemark, by: 'mira', prepare: async (a) => ({ fiscalYearId: a.y2025, kind: 'finding', targetType: 'year', targetId: a.y2025, text: 'Beleg fehlt.' }) },
  { name: 'answerAuditRemark', service: answerAuditRemark, by: 'anna', prepare: async (a) => ({ remarkId: (await a.remark()).id, text: 'Für die Pflegestelle.' }) },
  { name: 'followUpAuditRemark', service: followUpAuditRemark, by: 'mira', prepare: async (a) => ({ remarkId: (await a.remark()).id, text: 'Beleg dazu?' }) },
  { name: 'resolveAuditRemark', service: resolveAuditRemark, by: 'mira', prepare: async (a) => ({ remarkId: (await a.remark()).id }) },
  { name: 'createAuditReportDraft', service: createAuditReportDraft, by: 'mira', prepare: async (a) => ({ fiscalYearId: a.y2025, kind: 'report' }) },
  { name: 'saveAuditReportExamination', service: saveAuditReportExamination, by: 'mira', prepare: async (a) => { const d = await a.draft(); return { reportId: d.id, expectedVersion: d.examination.version, dates: ['2026-02-18'] }; } },
  { name: 'saveAuditReportResult', service: saveAuditReportResult, by: 'mira', prepare: async (a) => ({ reportId: (await a.draft()).id, result: 'clean', recommendation: 'discharge' }) },
  { name: 'saveAuditReportDeviation', service: saveAuditReportDeviation, by: 'mira', prepare: async (a) => ({ reportId: (await a.draft()).id, text: 'Ich sehe das anders.' }) },
  { name: 'saveAuditReportSignatures', service: saveAuditReportSignatures, by: 'mira', prepare: async (a) => ({ reportId: (await a.draft()).id, mode: 'both' }) },
  { name: 'markAuditReportReadyToSign', service: markAuditReportReadyToSign, by: 'mira', prepare: async (a) => ({ reportId: (await a.ready()).id }) },
  {
    name: 'revokeAuditReportReadyToSign', service: revokeAuditReportReadyToSign, by: 'mira',
    prepare: async (a) => { const d = await a.ready(); unwrap(await markAuditReportReadyToSign(a.f.deps, a.mira.ctx, { reportId: d.id })); return { reportId: d.id }; },
  },
  { name: 'endAuditorAccess', service: endAuditorAccess, by: 'anna', prepare: async (a) => ({ id: a.miraAuditor.id }) },
  { name: 'fileConfidentialityDeclaration', service: fileConfidentialityDeclaration, by: 'anna', prepare: async (a) => ({ auditorId: a.miraAuditor.id, bytes: pdfBytes(), fileName: 'erklaerung.pdf' }) },
];

const failure = (r: Result<unknown>) => (r.ok ? 'ok' : r.error);

describe('Kassenprüfung über MCP: persönliche Schritte (D1c)', () => {
  it.each(cases)('$name: humanOnly without the switch and nothing written; forbidden without the right; with the switch written over mcp', async ({ service, by, prepare }) => {
    const a = await setup();
    const { f } = a;
    const input = await prepare(a);
    const userId = by === 'mira' ? a.mira.userId : f.userId;
    const base = by === 'mira' ? a.mira.ctx : f.ctx;
    const agent: CallContext = { ...base, channel: 'mcp', apiTokenId: `TOKEN-${by}` };

    const before = snapshot(f);
    expect(failure(await service(f.deps, agent, input))).toMatchObject({ type: 'conflict', code: 'humanOnly' });
    expect(snapshot(f)).toBe(before);

    const noRight: CallContext = { ...ctxWith(['finance.read'], userId), channel: 'mcp', apiTokenId: `TOKEN-${by}` };
    expect(failure(await service(f.deps, noRight, input))).toMatchObject({ type: 'forbidden' });

    allowHumanOnlyOverMcp(f.deps);
    const logged = f.deps.db.select().from(schema.auditLog).all().length;
    expect(failure(await service(f.deps, agent, input))).toBe('ok');
    const added = f.deps.db.select().from(schema.auditLog).all().slice(logged).filter((e) => e.action.startsWith('finance.audit.'));
    expect(added.length).toBeGreaterThan(0);
    for (const entry of added) expect(entry).toMatchObject({ channel: 'mcp', apiTokenId: `TOKEN-${by}`, userId });
  });
});
