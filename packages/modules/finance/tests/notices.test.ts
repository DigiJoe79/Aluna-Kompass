import { readSetting, schema, setSetting, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { documentLinks, documents, documentTypes } from '@kompass/module-dms';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { checkConfirmable } from '../src/donations/check';
import { attachNoticeDocument, exemptionStartInternal, listNotices, noticeExpiryInternal, noticeValidAtInternal, saveNotice, supersedeNotice, voidNotice } from '../src/donations/notices';
import { FINANCE_PERMISSIONS } from '../src/manifest';
import { financeNotices } from '../src/schema';
import { donationFixture } from './donation-fixture';
import { insertDocument, ledgerFixture, pdfBytes } from './helpers';

const exemption = { kind: 'exemptionNotice', taxOffice: 'Finanzamt Musterstadt', taxNumber: '99/999/99999', noticeDate: '2025-05-02', exemptFrom: '2023-01-01', assessmentPeriod: '2023', purposesText: 'Förderung des Tierschutzes (§ 52 Abs. 2 Nr. 14 AO)' } as const;
const provisional = { kind: 'section60a', taxOffice: 'Finanzamt Musterstadt', taxNumber: '99/999/99990', noticeDate: '2024-01-10', exemptFrom: '2024-01-01', purposesText: 'Förderung des Tierschutzes', purposesTextAccusative: 'den Tierschutz' } as const;

const auditOf = (deps: Awaited<ReturnType<typeof ledgerFixture>>['deps'], action: string) => deps.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, action)).all();
/** Ein Dokument der Akte lesen darf nur, wer `dms.view` hat — wie in `vouchers.test.ts`. */
const withDms = (f: Awaited<ReturnType<typeof ledgerFixture>>) => ctxWith([...FINANCE_PERMISSIONS, 'dms.view'], f.userId);
const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);

describe('saveNotice', () => {
  it('records a notice with its day-exact validity, and logs neither office, number nor purposes', async () => {
    const f = await ledgerFixture();
    f.deps.clock.set('2026-03-01T10:00:00.000Z');
    const notice = unwrap(await saveNotice(f.deps, f.ctx, exemption));
    expect(notice).toMatchObject({ kind: 'exemptionNotice', noticeDate: '2025-05-02', validUntil: '2030-05-02', state: 'valid', documentNumber: null });
    const [entry] = auditOf(f.deps, 'finance.notice.save');
    expect(entry).toMatchObject({ entityType: 'financeNotice', entityId: notice.id });
    expect(JSON.parse(entry!.after as string)).toEqual({ kind: 'exemptionNotice', noticeDate: '2025-05-02', exemptFrom: '2023-01-01', assessmentPeriod: '2023', documentId: null, supersededOn: null, supersededDocumentId: null, voided: false });
    expect(JSON.stringify(auditOf(f.deps, 'finance.notice.save'))).not.toMatch(/Musterstadt|99\/999|Tierschutz/);
  });

  it('needs finance.donationsIssue', async () => {
    const f = await ledgerFixture();
    const res = await saveNotice(f.deps, ctxWith(['finance.read'], f.userId), exemption);
    expect(err(res)).toMatchObject({ type: 'forbidden', permission: 'finance.donationsIssue' });
  });

  it('validates date, office, purposes, and asks for the assessment period of a final notice', async () => {
    const f = await ledgerFixture();
    expect(err(await saveNotice(f.deps, f.ctx, { ...exemption, noticeDate: '02.05.2025' }))).toMatchObject({ type: 'validation' });
    expect(err(await saveNotice(f.deps, f.ctx, { ...exemption, taxOffice: ' ' }))).toMatchObject({ type: 'validation' });
    expect(err(await saveNotice(f.deps, f.ctx, { ...exemption, purposesText: '' }))).toMatchObject({ type: 'validation' });
    expect(err(await saveNotice(f.deps, f.ctx, { ...exemption, assessmentPeriod: null }))).toMatchObject({ type: 'validation' });
    // Ein § 60a-Bescheid hat keinen Veranlagungszeitraum.
    expect(unwrap(await saveNotice(f.deps, f.ctx, provisional)).assessmentPeriod).toBeNull();
  });

  it('requires purposesTextAccusative for a section 60a notice (N8) and clears it for the other kinds', async () => {
    const f = await ledgerFixture();
    const { purposesTextAccusative: _omitted, ...withoutAccusative } = provisional;
    expect(err(await saveNotice(f.deps, f.ctx, withoutAccusative))).toMatchObject({ type: 'validation' });
    expect(err(await saveNotice(f.deps, f.ctx, { ...provisional, purposesTextAccusative: ' ' }))).toMatchObject({ type: 'validation' });
    const saved = unwrap(await saveNotice(f.deps, f.ctx, provisional));
    expect(saved.purposesTextAccusative).toBe('den Tierschutz');
    const final = unwrap(await saveNotice(f.deps, f.ctx, { ...exemption, purposesTextAccusative: 'den Tierschutz' }));
    expect(final.purposesTextAccusative).toBeNull();
  });

  it('stores the start of the exemption and refuses a notice without it', async () => {
    const f = await ledgerFixture();
    const notice = unwrap(await saveNotice(f.deps, f.ctx, exemption));
    expect(notice.exemptFrom).toBe('2023-01-01');
    expect(f.deps.db.select().from(financeNotices).where(eq(financeNotices.id, notice.id)).get()!.exemptFrom).toBe('2023-01-01');
    const { exemptFrom: _, ...withoutStart } = exemption;
    expect(err(await saveNotice(f.deps, f.ctx, withoutStart))).toMatchObject({ type: 'validation' });
    expect(err(await saveNotice(f.deps, f.ctx, { ...exemption, exemptFrom: '01.01.2023' }))).toMatchObject({ type: 'validation' });
    expect(err(await saveNotice(f.deps, f.ctx, { ...exemption, exemptFrom: null }))).toMatchObject({ type: 'validation' });
    // Beginn der Befreiung: das kleinste „ab“ aller nicht irrtümlich erfassten Bescheide.
    expect(exemptionStartInternal(f.deps.db)).toBe('2023-01-01');
    const mistaken = unwrap(await saveNotice(f.deps, f.ctx, { ...provisional, noticeDate: '2023-06-01', exemptFrom: '2022-07-01' }));
    expect(exemptionStartInternal(f.deps.db)).toBe('2022-07-01');
    unwrap(await voidNotice(f.deps, f.ctx, { id: mistaken.id, note: 'Doppelt erfasst' }));
    expect(exemptionStartInternal(f.deps.db)).toBe('2023-01-01');
  });

  it('a section 60a notice may start the exemption after its date', async () => {
    const f = await donationFixture({ notice: false });
    expect(exemptionStartInternal(f.deps.db)).toBeNull();
    // Feststellung nach § 60a vom 01.03.2025, die Befreiung beginnt erst mit dem nächsten Veranlagungszeitraum.
    const notice = unwrap(await saveNotice(f.deps, f.ctx, { ...provisional, noticeDate: '2025-03-01', exemptFrom: '2026-01-01' }));
    expect(notice).toMatchObject({ state: 'valid', exemptFrom: '2026-01-01' });
    const between = await f.donate({ date: '2025-06-01' });
    const res = unwrap(await checkConfirmable(f.deps, f.ctx, { lineIds: [between.line.id] }));
    // Der Bescheid trägt am Ausstellungstag — gesperrt ist die Zuwendung trotzdem.
    expect(res.checks.find((c) => c.key === 'noticeValid')).toMatchObject({ done: true, blocked: false });
    expect(res.checks.find((c) => c.key === 'afterExemptionStart')).toMatchObject({ done: false, blocked: true, detail: { exemptFrom: '2026-01-01', entryDate: '2025-06-01' } });
    expect(res.ok).toBe(false);
    const after = await f.donate({ date: '2026-01-02' });
    expect(unwrap(await checkConfirmable(f.deps, f.ctx, { lineIds: [after.line.id] })).ok).toBe(true);
  });

  it('changes a notice while it is neither superseded nor voided', async () => {
    const f = await ledgerFixture();
    f.deps.clock.set('2026-03-01T10:00:00.000Z');
    const notice = unwrap(await saveNotice(f.deps, f.ctx, exemption));
    const changed = unwrap(await saveNotice(f.deps, f.ctx, { ...exemption, id: notice.id, taxNumber: '99/999/99998' }));
    expect(changed).toMatchObject({ id: notice.id, taxNumber: '99/999/99998' });
    unwrap(await voidNotice(f.deps, f.ctx, { id: notice.id, note: 'Falsche Steuernummer' }));
    expect(err(await saveNotice(f.deps, f.ctx, { ...exemption, id: notice.id }))).toMatchObject({ type: 'conflict', code: 'noticeVoided' });
    expect(err(await saveNotice(f.deps, f.ctx, { ...exemption, id: 'nope' }))).toMatchObject({ type: 'notFound' });
  });

  it('links a finalized, readable document of the file module, and refuses a draft', async () => {
    const f = await ledgerFixture();
    const documentId = insertDocument(f, { subject: 'Bescheid', typeKey: 'letter' });
    expect(err(await saveNotice(f.deps, f.ctx, { ...exemption, documentId }))).toMatchObject({ type: 'forbidden', permission: 'dms.view' });
    const notice = unwrap(await saveNotice(f.deps, withDms(f), { ...exemption, documentId }));
    expect(notice.documentNumber).toMatch(/^DOC-2026-/);
    expect(f.deps.db.select().from(documentLinks).where(and(eq(documentLinks.documentId, documentId), eq(documentLinks.entityType, 'financeNotice'), eq(documentLinks.entityId, notice.id))).get()).toBeTruthy();
    const voided = insertDocument(f, { subject: 'Alt', typeKey: 'letter', voided: true });
    expect(err(await saveNotice(f.deps, withDms(f), { ...exemption, documentId: voided }))).toMatchObject({ type: 'conflict', code: 'documentVoided' });
  });

  it('refuses a section 60a notice after an exemption notice', async () => {
    const f = await ledgerFixture();
    unwrap(await saveNotice(f.deps, f.ctx, exemption));
    const res = await saveNotice(f.deps, f.ctx, { ...provisional, noticeDate: '2025-06-01' });
    expect(err(res)).toMatchObject({ type: 'conflict', code: 'noticeAfterExemption' });
    // Die übliche Reihenfolge — erst § 60a, dann der endgültige Bescheid — bleibt erlaubt.
    expect((await saveNotice(f.deps, f.ctx, provisional)).ok).toBe(true);
  });

  it('writes tax office, tax number and notice type back to the core settings on every change (E22)', async () => {
    const f = await ledgerFixture();
    f.deps.clock.set('2026-03-01T10:00:00.000Z');
    const setting = (key: string) => readSetting(f.deps, key);

    const first = unwrap(await saveNotice(f.deps, f.ctx, provisional));
    expect([setting('organization.taxOffice'), setting('organization.taxNumber'), setting('organization.exemptionNoticeType'), setting('organization.exemptionNoticeDate')]).toEqual(['Finanzamt Musterstadt', '99/999/99990', 'section60a', '2024-01-10']);

    const final = unwrap(await saveNotice(f.deps, f.ctx, exemption));
    expect([setting('organization.taxNumber'), setting('organization.exemptionNoticeType'), setting('organization.exemptionNoticeDate')]).toEqual(['99/999/99999', 'exemptionNotice', '2025-05-02']);

    unwrap(await saveNotice(f.deps, f.ctx, { ...exemption, id: final.id, taxOffice: 'Finanzamt Beispielstadt' }));
    expect(setting('organization.taxOffice')).toBe('Finanzamt Beispielstadt');

    // Ist der endgültige Bescheid irrtümlich erfasst, trägt wieder § 60a — die Vereinsdaten folgen.
    unwrap(await voidNotice(f.deps, f.ctx, { id: final.id, note: 'Doppelt erfasst' }));
    expect([setting('organization.taxNumber'), setting('organization.exemptionNoticeType'), setting('organization.exemptionNoticeDate')]).toEqual(['99/999/99990', 'section60a', '2024-01-10']);

    // Ohne gültigen Bescheid: Art „none“, kein Datum — Finanzamt und Steuernummer bleiben die des jüngsten Bescheids.
    unwrap(await supersedeNotice(f.deps, f.ctx, { id: first.id, supersededOn: '2026-02-01' }));
    expect([setting('organization.taxOffice'), setting('organization.taxNumber'), setting('organization.exemptionNoticeType'), setting('organization.exemptionNoticeDate')]).toEqual(['Finanzamt Musterstadt', '99/999/99990', 'none', '']);
    expect(auditOf(f.deps, 'finance.notice').map((e) => e.entityId)).toContain('organization.exemptionNoticeType');
  });

  it('the core setting cannot be changed directly while finance is enabled (settingManaged)', async () => {
    const f = await ledgerFixture();
    const admin = ctxWith(['settings.manage'], f.userId);
    for (const [key, value] of [['organization.taxOffice', 'Finanzamt Anderswo'], ['organization.taxNumber', '11/111/11111'], ['organization.exemptionNoticeType', 'section60a'], ['organization.exemptionNoticeDate', '2026-01-01']] as const) {
      expect(err(await setSetting(f.deps, admin, { key, value })), key).toEqual({ type: 'conflict', code: 'settingManaged', message: 'finance' });
    }
  });
});

describe('attachNoticeDocument', () => {
  /** Die Vorgabe-Art für Eingänge legt sonst die Installation der Akte an — die Fixture installiert nur Finanzen. */
  const withIncomingType = (f: Awaited<ReturnType<typeof ledgerFixture>>) => {
    f.deps.db.insert(documentTypes).values({ key: readSetting<string>(f.deps, 'dms.defaultTypeIncoming'), label: 'Eingang', prefix: 'EIN', defaultDirection: 'incoming', retentionClass: 'statutory10Y', defaultFolder: null, isActive: true, sortOrder: 0, ownerModule: null, protectionArea: null }).run();
    return f;
  };

  it('files an uploaded notice as an incoming document of the file, links it and sets it on the notice — without dms rights', async () => {
    const f = withIncomingType(await ledgerFixture());
    f.deps.clock.set('2026-03-01T10:00:00.000Z');
    const notice = unwrap(await saveNotice(f.deps, f.ctx, exemption));
    const issuer = ctxWith(['finance.read', 'finance.donationsIssue'], f.userId);
    const attached = unwrap(await attachNoticeDocument(f.deps, issuer, { id: notice.id, bytes: pdfBytes() }));
    expect(attached.documentId).not.toBeNull();
    expect(attached.documentNumber).toMatch(/^EIN-/);
    const doc = f.deps.db.select().from(documents).where(eq(documents.id, attached.documentId!)).get()!;
    expect(doc).toMatchObject({ direction: 'incoming', typeKey: readSetting<string>(f.deps, 'dms.defaultTypeIncoming') });
    // Der Betreff nennt weder Finanzamt noch Steuernummer.
    expect(doc.subject).not.toMatch(/Musterstadt|99\/999/);
    const link = f.deps.db.select().from(documentLinks).where(and(eq(documentLinks.documentId, doc.id), eq(documentLinks.entityType, 'financeNotice'))).get();
    expect(link?.entityId).toBe(notice.id);
    const [entry] = auditOf(f.deps, 'finance.notice.document');
    expect(JSON.parse(entry!.after as string)).toEqual({ documentId: doc.id });
  });

  it('needs finance.donationsIssue, a pdf and a notice that still counts', async () => {
    const f = withIncomingType(await ledgerFixture());
    f.deps.clock.set('2026-03-01T10:00:00.000Z');
    const notice = unwrap(await saveNotice(f.deps, f.ctx, exemption));
    expect(err(await attachNoticeDocument(f.deps, ctxWith(['finance.read'], f.userId), { id: notice.id, bytes: pdfBytes() }))).toMatchObject({ type: 'forbidden', permission: 'finance.donationsIssue' });
    expect(err(await attachNoticeDocument(f.deps, f.ctx, { id: notice.id }))).toMatchObject({ type: 'validation' });
    expect(err(await attachNoticeDocument(f.deps, f.ctx, { id: 'nope', bytes: pdfBytes() }))).toMatchObject({ type: 'notFound' });
    unwrap(await voidNotice(f.deps, f.ctx, { id: notice.id, note: 'Falsch erfasst' }));
    expect(err(await attachNoticeDocument(f.deps, f.ctx, { id: notice.id, bytes: pdfBytes() }))).toMatchObject({ type: 'conflict', code: 'noticeVoided' });
    expect(f.deps.db.select().from(documentLinks).where(eq(documentLinks.entityType, 'financeNotice')).all()).toHaveLength(0);
  });
});

describe('supersedeNotice and voidNotice', () => {
  it('supersede and void are one-time and end validity from their date', async () => {
    const f = await ledgerFixture();
    f.deps.clock.set('2026-03-01T10:00:00.000Z');
    const notice = unwrap(await saveNotice(f.deps, f.ctx, exemption));
    const repeal = insertDocument(f, { subject: 'Aufhebung', typeKey: 'letter' });
    const superseded = unwrap(await supersedeNotice(f.deps, withDms(f), { id: notice.id, supersededOn: '2026-02-15', documentId: repeal }));
    expect(superseded).toMatchObject({ supersededOn: '2026-02-15', supersededDocumentId: repeal, state: 'superseded' });
    expect(noticeValidAtInternal(f.deps.db, '2026-02-14')?.id).toBe(notice.id);
    expect(noticeValidAtInternal(f.deps.db, '2026-02-15')).toBeNull();
    expect(err(await supersedeNotice(f.deps, f.ctx, { id: notice.id, supersededOn: '2026-02-16' }))).toMatchObject({ type: 'conflict', code: 'noticeSuperseded' });
    expect(JSON.parse(auditOf(f.deps, 'finance.notice.supersede')[0]!.after as string)).toEqual({ supersededOn: '2026-02-15', supersededDocumentId: repeal });

    const other = unwrap(await saveNotice(f.deps, f.ctx, { ...exemption, noticeDate: '2026-02-20' }));
    const voided = unwrap(await voidNotice(f.deps, f.ctx, { id: other.id, note: 'Tippfehler im Datum' }));
    expect(voided).toMatchObject({ state: 'voided', voidNote: 'Tippfehler im Datum' });
    expect(noticeValidAtInternal(f.deps.db, '2026-03-01')).toBeNull();
    expect(err(await voidNotice(f.deps, f.ctx, { id: other.id, note: 'nochmal' }))).toMatchObject({ type: 'conflict', code: 'noticeVoided' });
    expect(err(await supersedeNotice(f.deps, f.ctx, { id: other.id, supersededOn: '2026-03-01' }))).toMatchObject({ type: 'conflict', code: 'noticeVoided' });
    const voidEntry = auditOf(f.deps, 'finance.notice.void')[0]!;
    expect(JSON.parse(voidEntry.after as string)).toEqual({ voided: true });
    expect(JSON.stringify(voidEntry)).not.toMatch(/Tippfehler/);
  });

  it('checks permission and input', async () => {
    const f = await ledgerFixture();
    const notice = unwrap(await saveNotice(f.deps, f.ctx, exemption));
    const reader = ctxWith(['finance.read'], f.userId);
    expect(err(await supersedeNotice(f.deps, reader, { id: notice.id, supersededOn: '2026-01-01' }))).toMatchObject({ type: 'forbidden' });
    expect(err(await voidNotice(f.deps, reader, { id: notice.id, note: 'x' }))).toMatchObject({ type: 'forbidden' });
    expect(err(await voidNotice(f.deps, f.ctx, { id: notice.id, note: '' }))).toMatchObject({ type: 'validation' });
    expect(err(await supersedeNotice(f.deps, f.ctx, { id: notice.id, supersededOn: '2025-05-01' }))).toMatchObject({ type: 'validation' });
    expect(err(await supersedeNotice(f.deps, f.ctx, { id: 'nope', supersededOn: '2026-01-01' }))).toMatchObject({ type: 'notFound' });
  });
});

describe('listNotices', () => {
  it('lists with finance.read, newest first; inactive ones only on request', async () => {
    const f = await ledgerFixture();
    f.deps.clock.set('2026-03-01T10:00:00.000Z');
    const old = unwrap(await saveNotice(f.deps, f.ctx, provisional));
    const current = unwrap(await saveNotice(f.deps, f.ctx, exemption));
    const future = unwrap(await saveNotice(f.deps, f.ctx, { ...exemption, noticeDate: '2026-06-01', assessmentPeriod: '2024' }));
    const reader = ctxWith(['finance.read'], f.userId);
    const active = unwrap(await listNotices(f.deps, reader, {}));
    expect(active.map((n) => [n.id, n.state])).toEqual([[future.id, 'future'], [current.id, 'valid']]);
    const all = unwrap(await listNotices(f.deps, reader, { includeInactive: true }));
    // Ein § 60a-Bescheid, dem ein endgültiger folgt, gilt als ersetzt — auch ohne eigenes Datum.
    expect(all.map((n) => [n.id, n.state])).toEqual([[future.id, 'future'], [current.id, 'valid'], [old.id, 'superseded']]);
    expect(err(await listNotices(f.deps, ctxWith(['finance.overview'], f.userId), {}))).toMatchObject({ type: 'forbidden' });
  });
});

describe('noticeExpiryInternal', () => {
  it('names the current notice from the configured months before its end on, with the months left', async () => {
    const f = await ledgerFixture();
    f.deps.clock.set('2026-03-01T10:00:00.000Z');
    const notice = unwrap(await saveNotice(f.deps, f.ctx, { ...provisional, noticeDate: '2023-09-15' })); // gültig bis 2026-09-15
    expect(noticeExpiryInternal(f.deps.db, '2026-03-01', 6)).toBeNull();
    expect(noticeExpiryInternal(f.deps.db, '2026-03-15', 6)).toEqual({ noticeId: notice.id, validUntil: '2026-09-15', monthsLeft: 6 });
    expect(noticeExpiryInternal(f.deps.db, '2026-08-20', 6)).toEqual({ noticeId: notice.id, validUntil: '2026-09-15', monthsLeft: 0 });
    expect(noticeExpiryInternal(f.deps.db, '2026-09-16', 6)).toBeNull();
    expect(f.deps.db.select().from(financeNotices).all()).toHaveLength(1);
  });
});
