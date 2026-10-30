import { resolveRecordLabel, schema, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { documentLinks, documents } from '@kompass/module-dms';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { fundsUseOpeningsInternal, listFundsUseOpenings, saveFundsUseOpening } from '../src/allocation/funds-use-openings';
import { financeRecordDeleted, financeRetentionHolds } from '../src/ledger/holds';
import { reopenFiscalYear } from '../src/ledger/period';
import { FINANCE_MCP_TOOLS } from '../src/mcp-tools';
import { FINANCE_PERMISSIONS } from '../src/manifest';
import { financeFundsUseOpenings } from '../src/schema';
import { insertDocument, ledgerFixture, pdfBytes } from './helpers';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);
const upload = () => ({ bytes: pdfBytes(), fileName: 'mvr-2025.pdf' });
const year1 = { offset: 1, designation: '2025', endsOn: '2025-12-31', revenueCents: 5_200_000, amountCents: 300_000 } as const;
const year2 = { offset: 2, designation: '2024', endsOn: '2024-12-31', revenueCents: 4_000_000, amountCents: 150_000 } as const;

describe('Anfangsvortrag der Mittelverwendung je Entstehungsjahr (M1 Task 3, Prüfung L-4)', () => {
  it('saves the year before the first year with its limit', async () => {
    const f = await ledgerFixture();
    const saved = unwrap(await saveFundsUseOpening(f.deps, f.ctx, { ...year1, upload: upload() }));
    expect(saved).toMatchObject({ offset: 1, designation: '2025', effectiveCents: 300_000, limitCents: 4_500_000, zeroReason: null, dueBy: '2027-12-31' });
    const audit = f.deps.db.select().from(schema.auditLog).all().filter((a) => a.action === 'finance.fundsUseOpening.save');
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0]!.params!)).toEqual({ offset: 1, created: true });
    expect(JSON.parse(audit[0]!.after!)).toEqual({ offset: 1, endsOn: '2025-12-31', revenueCents: 5_200_000, amountCents: 300_000 });
    const doc = f.deps.db.select({ id: documents.id, subject: documents.subject, typeKey: documents.typeKey }).from(documents).where(eq(documents.id, saved.documentId!)).get()!;
    expect(doc).toMatchObject({ typeKey: 'finance-tax-return', subject: 'Beleg Anfangsvortrag Mittelverwendung 2025' });
    const link = f.deps.db.select().from(documentLinks).where(and(eq(documentLinks.documentId, doc.id), eq(documentLinks.entityType, 'financeFundsUseOpening'))).get();
    expect(link?.entityId).toBe(saved.id);
    expect(fundsUseOpeningsInternal(f.deps.db)).toEqual([{ offset: 1, designation: '2025', endsOn: '2025-12-31', revenueCents: 5_200_000, amountCents: 300_000, limitCents: 4_500_000 }]);

    const overview = unwrap(await listFundsUseOpenings(f.deps, f.ctx, {}));
    expect(overview).toMatchObject({ firstFiscalYear: { id: f.year.id, designation: '2026', startsOn: '2026-01-01' }, changeable: true, expectedEndsOn: { offset1: '2025-12-31' } });
    expect(overview.openings).toHaveLength(1);

    // Ändern ohne Beleg behält den vorhandenen; die Sperre läuft über `updatedAt`.
    const changed = unwrap(await saveFundsUseOpening(f.deps, f.ctx, { ...year1, amountCents: 200_000, expectedVersion: saved.updatedAt }));
    expect(changed).toMatchObject({ amountCents: 200_000, documentId: saved.documentId });
    expect(err(await saveFundsUseOpening(f.deps, f.ctx, { ...year1, expectedVersion: saved.updatedAt }))).toMatchObject({ type: 'conflict', code: 'staleVersion' });
    const audits = f.deps.db.select().from(schema.auditLog).all().filter((a) => a.action === 'finance.fundsUseOpening.save');
    expect(JSON.parse(audits[1]!.params!)).toEqual({ offset: 1, created: false });
  });

  it('older year needs the newer one and drops below the limit', async () => {
    const f = await ledgerFixture();
    expect(err(await saveFundsUseOpening(f.deps, f.ctx, { ...year2, upload: upload() }))).toMatchObject({ type: 'conflict', code: 'fundsUseOpeningPreviousMissing' });
    unwrap(await saveFundsUseOpening(f.deps, f.ctx, { ...year1, upload: upload() }));
    const older = unwrap(await saveFundsUseOpening(f.deps, f.ctx, { ...year2, upload: upload() }));
    expect(older).toMatchObject({ offset: 2, effectiveCents: 0, zeroReason: 'belowLimit', limitCents: 4_500_000 });
    expect(err(await saveFundsUseOpening(f.deps, f.ctx, { ...year2, endsOn: '2023-12-31', expectedVersion: older.updatedAt }))).toMatchObject({ type: 'validation' });
  });

  it('rejects wrong dates and amounts', async () => {
    const f = await ledgerFixture();
    const wrongDate = err(await saveFundsUseOpening(f.deps, f.ctx, { ...year1, endsOn: '2025-06-30', upload: upload() }));
    expect(wrongDate).toMatchObject({ type: 'validation', issues: [{ path: 'endsOn', message: 'endsOnMismatch' }] });
    const tooMuch = err(await saveFundsUseOpening(f.deps, f.ctx, { ...year1, amountCents: 6_000_000, upload: upload() }));
    expect(tooMuch).toMatchObject({ type: 'validation', issues: [{ path: 'amountCents', message: 'amountAboveRevenue' }] });
    expect(f.deps.db.select().from(financeFundsUseOpenings).all()).toHaveLength(0);
  });

  it('locked once the first year is closed, free again after reopening', async () => {
    const f = await ledgerFixture();
    const saved = unwrap(await saveFundsUseOpening(f.deps, f.ctx, { ...year1, upload: upload() }));
    f.closeYear(f.year.id);
    expect(err(await saveFundsUseOpening(f.deps, f.ctx, { ...year1, amountCents: 1, expectedVersion: saved.updatedAt }))).toMatchObject({ type: 'conflict', code: 'fundsUseOpeningLocked', params: { designation: '2026' } });
    expect(unwrap(await listFundsUseOpenings(f.deps, f.ctx, {})).changeable).toBe(false);
    // Der Fixture-Abschluss steht am 31.12.2026 — das Wiederöffnen kommt danach.
    f.deps.clock.set('2027-02-01T10:00:00.000Z');
    unwrap(await reopenFiscalYear(f.deps, f.ctx, { id: f.year.id, note: 'Anfangsvortrag nach Prüfung' }));
    unwrap(await saveFundsUseOpening(f.deps, f.ctx, { ...year1, amountCents: 1, expectedVersion: saved.updatedAt }));
  });

  it('forbidden without finance.setup; without a first year not found', async () => {
    const f = await ledgerFixture();
    const reader = ctxWith(FINANCE_PERMISSIONS.filter((p) => p !== 'finance.setup'), f.userId);
    expect(err(await saveFundsUseOpening(f.deps, reader, { ...year1, upload: upload() }))).toMatchObject({ type: 'forbidden', permission: 'finance.setup' });
    expect(unwrap(await listFundsUseOpenings(f.deps, reader, {})).openings).toEqual([]);
  });

  it('finance.setup alone is enough to upload the evidence (Abnahme M1)', async () => {
    const f = await ledgerFixture();
    const setupOnly = ctxWith(['finance.setup'], f.userId);
    const saved = unwrap(await saveFundsUseOpening(f.deps, setupOnly, { ...year1, upload: upload() }));
    expect(saved.documentId).toEqual(expect.any(String));
    expect(resolveRecordLabel(f.deps, ctxWith(['finance.read'], f.userId), 'financeFundsUseOpening', saved.id)).toMatchObject({ state: 'ok', label: '2025' });
  });

  it('requires a document on create, never both', async () => {
    const f = await ledgerFixture();
    expect(err(await saveFundsUseOpening(f.deps, f.ctx, year1))).toMatchObject({ type: 'conflict', code: 'fundsUseOpeningDocumentRequired' });
    const docId = insertDocument(f, { subject: 'MVR 2025', typeKey: 'finance-tax-return' });
    expect(err(await saveFundsUseOpening(f.deps, f.ctx, { ...year1, documentId: docId, upload: upload() }))).toMatchObject({ type: 'validation', issues: [{ path: 'upload', message: 'pickOrUploadNotBoth' }] });
  });

  it('the document is held, and a tombstone stays after the retention period', async () => {
    const f = await ledgerFixture();
    const saved = unwrap(await saveFundsUseOpening(f.deps, f.ctx, { ...year1, upload: upload() }));
    expect(financeRetentionHolds(f.deps, 'document', saved.documentId!)).toEqual([{ label: { key: 'finance.records.fundsUseOpening', params: { designation: '2025' } }, until: null, entity: 'financeFundsUseOpening', id: saved.id }]);
    f.deps.db.transaction((tx) => financeRecordDeleted(tx, f.deps, f.ctx, 'document', saved.documentId!));
    expect(f.deps.db.select().from(financeFundsUseOpenings).get()).toMatchObject({ id: saved.id, documentId: null, amountCents: 300_000 });
    const gone = f.deps.db.select().from(schema.auditLog).all().filter((a) => a.action === 'finance.fundsUseOpening.documentGone');
    expect(gone).toHaveLength(1);
    expect(gone[0]!.entityId).toBe(saved.id);
  });

  it('mcp tool returns the same view', async () => {
    const f = await ledgerFixture();
    const withDms = ctxWith([...FINANCE_PERMISSIONS, 'dms.view'], f.userId);
    const docId = insertDocument(f, { subject: 'MVR 2025', typeKey: 'finance-tax-return' });
    const tool = FINANCE_MCP_TOOLS.find((t) => t.name === 'finance_funds_use_opening_save')!;
    const viaMcp = unwrap(await tool.handler(f.deps, withDms, { ...year1, documentId: docId })) as { id: string; documentId: string };
    expect(viaMcp).toMatchObject({ effectiveCents: 300_000, documentId: docId });
    const list = FINANCE_MCP_TOOLS.find((t) => t.name === 'finance_funds_use_openings_list')!;
    expect(unwrap(await list.handler(f.deps, withDms, {}))).toEqual(unwrap(await listFundsUseOpenings(f.deps, withDms, {})));
  });
});
