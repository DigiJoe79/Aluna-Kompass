import { newId, unwrap } from '@kompass/core';
import { financeNotices } from '@kompass/module-finance';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { issueAttendanceList } from '../src/minutes/attachments';
import { createRegisterFiling } from '../src/register/filings';
import { filingRequirements, setFilingDocuments } from '../src/register/requirements';
import { updateStatute } from '../src/statutes';
import { auditOf, receivedDocument, RECORDING, setupGovernance } from './helpers';
import { chairResigns, statuteMeeting } from './register-helpers';

const row = (rows: { key: string }[], key: string) => rows.find((r) => r.key === key);

describe('filing requirements', () => {
  it('statute change: minutes and statute text are the required rows; without the text it stays open', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const change = await statuteMeeting(deps, ctx, '2026-06-10');
    const filing = unwrap(await createRegisterFiling(deps, ctx, { occasions: [{ id: change.occasionId }] }));
    let rows = unwrap(await filingRequirements(deps, ctx, { filingId: filing.id }));
    expect(rows.map((r) => [r.key, r.level])).toEqual([['resolutionCopy', 'required'], ['statuteText', 'required'], ['invitation', 'recommended'], ['attendanceList', 'recommended'], ['registerData', 'recommended'], ['taxNotice', 'recommended']]);
    expect(row(rows, 'resolutionCopy')).toEqual({ key: 'resolutionCopy', level: 'required', documentIds: [change.minutesDocumentId], met: true, source: 'computed' });
    expect(row(rows, 'statuteText')).toMatchObject({ met: false, documentIds: [] });

    const text = await receivedDocument(deps, 'Satzung');
    unwrap(await updateStatute(deps, ctx, { id: change.statuteId, documentId: text }));
    const list = unwrap(await issueAttendanceList(deps, ctx, { meetingId: change.meetingId }));
    rows = unwrap(await filingRequirements(deps, ctx, { filingId: filing.id }));
    expect(row(rows, 'statuteText')).toMatchObject({ met: true, documentIds: [text] });
    expect(row(rows, 'attendanceList')).toMatchObject({ met: true, documentIds: [list.documentId] });
    expect(row(rows, 'taxNotice')).toMatchObject({ met: false });
  });

  it('a board change alone has no statute row; a hand-set document counts as manual', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const filing = unwrap(await createRegisterFiling(deps, ctx, { occasions: [{ id: await chairResigns(deps, ctx) }] }));
    const rows = unwrap(await filingRequirements(deps, ctx, { filingId: filing.id }));
    expect(rows.map((r) => r.key)).toEqual(['resolutionCopy', 'registerData', 'taxNotice']);
    expect(row(rows, 'resolutionCopy')).toMatchObject({ met: false });
    const prt = await receivedDocument(deps, 'PRT-2026-002');
    const updated = unwrap(await setFilingDocuments(deps, ctx, { filingId: filing.id, key: 'resolutionCopy', documentIds: [prt] }));
    expect(updated.documents).toEqual({ resolutionCopy: [prt] });
    expect(auditOf(deps, 'governance.register.documents').at(-1)!.params).toEqual({ key: 'resolutionCopy', count: 1 });
    expect(row(unwrap(await filingRequirements(deps, ctx, { filingId: filing.id })), 'resolutionCopy')).toEqual({ key: 'resolutionCopy', level: 'required', documentIds: [prt], met: true, source: 'manual' });
    expect(await setFilingDocuments(deps, ctxWith(['governance.read'], 'x'), { filingId: filing.id, key: 'resolutionCopy', documentIds: [] })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await setFilingDocuments(deps, ctx, { filingId: filing.id, key: 'other', documentIds: [] })).toMatchObject({ ok: false, error: { type: 'validation' } });
  });

  it('the latest not voided § 60a notice with a document meets taxNotice (fee exemption)', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const filing = unwrap(await createRegisterFiling(deps, ctx, { occasions: [{ id: await chairResigns(deps, ctx) }] }));
    const documentId = await receivedDocument(deps, 'Bescheid');
    const base = { taxOffice: 'Finanzamt Beispielstadt', taxNumber: '12/345/67890', exemptFrom: '2026-01-01', purposesText: 'des Tierschutzes', createdAt: '2026-08-01T00:00:00.000Z', createdByUserId: 'system', updatedAt: '2026-08-01T00:00:00.000Z' };
    deps.db.insert(financeNotices).values({ ...base, id: newId(), kind: 'section60a', noticeDate: '2026-08-01', documentId }).run();
    deps.db.insert(financeNotices).values({ ...base, id: newId(), kind: 'section60a', noticeDate: '2026-08-20', documentId: null, voidedAt: '2026-08-21T00:00:00.000Z' }).run();
    expect(row(unwrap(await filingRequirements(deps, ctx, { filingId: filing.id })), 'taxNotice')).toMatchObject({ met: true, documentIds: [documentId] });
  });
});
