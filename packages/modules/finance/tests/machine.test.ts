import { listUserNamesWithPermission, schema, unwrap } from '@kompass/core';
import { ctxWith, insertRole, insertUser } from '@kompass/core/testing';
import { documents, documentTypes } from '@kompass/module-dms';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { saveNotice, voidNotice } from '../src/donations/notices';
import { createNotificationLetterDraft, FACSIMILE_MAX_BYTES, facsimileKeyFor, getMachineProcedure, machineProcedureStatusAt, readFacsimile, saveSigner, uploadFacsimile } from '../src/donations/machine';
import { notificationLetter } from '../src/donations/templates/wording';
import { FINANCE_PERMISSIONS } from '../src/manifest';
import { financeSigners } from '../src/schema';
import { ledgerFixture, pdfBytes } from './helpers';

type Fixture = Awaited<ReturnType<typeof ledgerFixture>>;

/** Ein PNG-Kopf (Magic Bytes) mit Füllung — die Dienste prüfen den Anfang, nicht das Bild. */
const png = (size = 64, fill = 1) => { const b = new Uint8Array(size).fill(fill); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); return b; };
const jpeg = (size = 64) => { const b = new Uint8Array(size).fill(2); b.set([0xff, 0xd8, 0xff, 0xe0]); return b; };

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);
const auditOf = (f: Fixture, action: string) => f.deps.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, action)).all();
const exemption = { kind: 'exemptionNotice', taxOffice: 'Finanzamt Musterstadt', taxNumber: '99/999/99999', noticeDate: '2025-05-02', assessmentPeriod: '2023', purposesText: 'Förderung des Tierschutzes' } as const;

/** Die Akte bringt die Art „Brief“ erst mit ihrer Grundausstattung — in den Tests legen wir sie an wie `insertDocument`. */
function ensureLetterType(f: Fixture): void {
  if (f.deps.db.select({ key: documentTypes.key }).from(documentTypes).where(eq(documentTypes.key, 'letter')).get()) return;
  f.deps.db.insert(documentTypes).values({ key: 'letter', label: 'Brief', prefix: 'BRF', defaultDirection: 'outgoing', retentionClass: 'statutory6Y', defaultFolder: null, isActive: true, sortOrder: 0, ownerModule: null, protectionArea: null }).run();
}

async function fixture() {
  const f = await ledgerFixture();
  f.deps.clock.set('2026-03-01T10:00:00.000Z');
  return f;
}

describe('saveSigner', () => {
  it('records a signer with a period, and logs neither the name nor anything but the period, the facsimile flag and the notification', async () => {
    const f = await fixture();
    const signer = unwrap(await saveSigner(f.deps, f.ctx, { validFrom: '2026-01-01', signerName: 'Jonas Feld', notifiedOn: '2026-02-01' }));
    expect(signer).toMatchObject({ validFrom: '2026-01-01', validTo: null, signerName: 'Jonas Feld', hasFacsimile: false, facsimileChecksum: null, notifiedOn: '2026-02-01', state: 'current' });
    const [entry] = auditOf(f, 'finance.signer.save');
    expect(entry).toMatchObject({ entityType: 'financeSigner', entityId: signer.id });
    expect(JSON.parse(entry!.after as string)).toEqual({ validFrom: '2026-01-01', validTo: null, hasFacsimile: false, notifiedOn: '2026-02-01' });
    expect(JSON.stringify(auditOf(f, 'finance.signer.save'))).not.toContain('Jonas');

    const ended = unwrap(await saveSigner(f.deps, f.ctx, { id: signer.id, validFrom: '2026-01-01', validTo: '2026-02-28', signerName: 'Jonas Feld', notifiedOn: '2026-02-01' }));
    expect(ended).toMatchObject({ id: signer.id, validTo: '2026-02-28', state: 'past' });
    expect(unwrap(await saveSigner(f.deps, f.ctx, { validFrom: '2026-07-01', signerName: 'Mara Linde' })).state).toBe('future');
  });

  it('needs finance.donationsIssue', async () => {
    const f = await fixture();
    expect(err(await saveSigner(f.deps, ctxWith(['finance.read'], f.userId), { validFrom: '2026-01-01', signerName: 'Jonas Feld' }))).toMatchObject({ type: 'forbidden', permission: 'finance.donationsIssue' });
  });

  it('validates dates, name and an end before the start', async () => {
    const f = await fixture();
    expect(err(await saveSigner(f.deps, f.ctx, { validFrom: '01.01.2026', signerName: 'Jonas Feld' }))).toMatchObject({ type: 'validation' });
    expect(err(await saveSigner(f.deps, f.ctx, { validFrom: '2026-01-01', signerName: ' ' }))).toMatchObject({ type: 'validation' });
    expect(err(await saveSigner(f.deps, f.ctx, { validFrom: '2026-03-01', validTo: '2026-02-28', signerName: 'Jonas Feld' }))).toMatchObject({ type: 'validation' });
    expect(err(await saveSigner(f.deps, f.ctx, { validFrom: '2026-01-01', signerName: 'Jonas Feld', notifiedOn: 'gestern' }))).toMatchObject({ type: 'validation' });
    expect(err(await saveSigner(f.deps, f.ctx, { id: 'nope', validFrom: '2026-01-01', signerName: 'Jonas Feld' }))).toMatchObject({ type: 'notFound' });
  });

  it('refuses overlapping signers', async () => {
    const f = await fixture();
    const first = unwrap(await saveSigner(f.deps, f.ctx, { validFrom: '2026-01-01', signerName: 'Jonas Feld' }));
    // Offen nach hinten: jeder spätere Beginn überschneidet sich.
    expect(err(await saveSigner(f.deps, f.ctx, { validFrom: '2026-07-01', signerName: 'Mara Linde' }))).toMatchObject({ type: 'conflict', code: 'signerOverlaps' });
    expect(err(await saveSigner(f.deps, f.ctx, { validFrom: '2025-06-01', validTo: '2026-01-01', signerName: 'Mara Linde' }))).toMatchObject({ type: 'conflict', code: 'signerOverlaps' });
    // Amtsübergabe: erst das Ende setzen, dann schließt der Nächste taggenau an.
    unwrap(await saveSigner(f.deps, f.ctx, { id: first.id, validFrom: '2026-01-01', validTo: '2026-06-30', signerName: 'Jonas Feld' }));
    expect((await saveSigner(f.deps, f.ctx, { validFrom: '2026-07-01', signerName: 'Mara Linde' })).ok).toBe(true);
    expect((await saveSigner(f.deps, f.ctx, { validFrom: '2025-01-01', validTo: '2025-12-31', signerName: 'Ole Brink' })).ok).toBe(true);
    // Der eigene Zeitraum ist keine Überschneidung.
    expect((await saveSigner(f.deps, f.ctx, { id: first.id, validFrom: '2026-01-01', validTo: '2026-06-30', signerName: 'Jonas Feld', notifiedOn: '2026-02-01' })).ok).toBe(true);
  });
});

describe('uploadFacsimile', () => {
  it('accepts png and jpeg up to 1 MB by magic bytes, refuses a pdf renamed png', async () => {
    const f = await fixture();
    const signer = unwrap(await saveSigner(f.deps, f.ctx, { validFrom: '2026-01-01', signerName: 'Jonas Feld' }));
    expect(FACSIMILE_MAX_BYTES).toBe(1024 * 1024);
    expect(unwrap(await uploadFacsimile(f.deps, f.ctx, { signerId: signer.id, bytes: png(FACSIMILE_MAX_BYTES), mimeType: 'image/png' })).hasFacsimile).toBe(true);
    expect(unwrap(await uploadFacsimile(f.deps, f.ctx, { signerId: signer.id, bytes: jpeg(), mimeType: 'image/png' })).hasFacsimile).toBe(true);
    expect(err(await uploadFacsimile(f.deps, f.ctx, { signerId: signer.id, bytes: pdfBytes(), mimeType: 'image/png' }))).toMatchObject({ type: 'conflict', code: 'facsimileNotImage' });
    expect(err(await uploadFacsimile(f.deps, f.ctx, { signerId: signer.id, bytes: png(FACSIMILE_MAX_BYTES + 1), mimeType: 'image/png' }))).toMatchObject({ type: 'conflict', code: 'facsimileTooLarge' });
  });

  it('needs finance.donationsIssue, bytes and a known signer', async () => {
    const f = await fixture();
    const signer = unwrap(await saveSigner(f.deps, f.ctx, { validFrom: '2026-01-01', signerName: 'Jonas Feld' }));
    expect(err(await uploadFacsimile(f.deps, ctxWith(['finance.read'], f.userId), { signerId: signer.id, bytes: png(), mimeType: 'image/png' }))).toMatchObject({ type: 'forbidden', permission: 'finance.donationsIssue' });
    expect(err(await uploadFacsimile(f.deps, f.ctx, { signerId: signer.id, mimeType: 'image/png' }))).toMatchObject({ type: 'validation' });
    expect(err(await uploadFacsimile(f.deps, f.ctx, { signerId: 'nope', bytes: png(), mimeType: 'image/png' }))).toMatchObject({ type: 'notFound' });
  });

  it('stores the facsimile in the module storage, never in the media library, and never logs its bytes or the signer name', async () => {
    const f = await fixture();
    const signer = unwrap(await saveSigner(f.deps, f.ctx, { validFrom: '2026-01-01', signerName: 'Jonas Feld' }));
    const store = f.deps.files('finance');
    const pngKey = facsimileKeyFor(signer.id, 'png');
    expect(pngKey).toBe(`signature-${signer.id.toLowerCase()}.png`);

    const first = unwrap(await uploadFacsimile(f.deps, f.ctx, { signerId: signer.id, bytes: png(64, 1), mimeType: 'image/png' }));
    expect(first.facsimileChecksum).toMatch(/^[0-9a-f]{64}$/);
    expect(await store.exists(pngKey)).toBe(true);
    expect(f.deps.db.select().from(financeSigners).where(eq(financeSigners.id, signer.id)).get()).toMatchObject({ facsimileKey: pngKey, facsimileChecksum: first.facsimileChecksum });

    // Dieselbe Endung, neue Bytes: die neue Datei ersetzt die alte.
    const second = unwrap(await uploadFacsimile(f.deps, f.ctx, { signerId: signer.id, bytes: png(64, 3), mimeType: 'image/png' }));
    expect(second.facsimileChecksum).not.toBe(first.facsimileChecksum);
    expect(await store.read(pngKey)).toEqual(png(64, 3));

    // Andere Endung: die alte Datei verschwindet.
    unwrap(await uploadFacsimile(f.deps, f.ctx, { signerId: signer.id, bytes: jpeg(), mimeType: 'image/jpeg' }));
    expect(await store.exists(pngKey)).toBe(false);
    expect(await store.exists(facsimileKeyFor(signer.id, 'jpg'))).toBe(true);

    expect(f.deps.db.select().from(schema.mediaAssets).all()).toEqual([]);
    const entries = auditOf(f, 'finance.signer.facsimile');
    expect(entries).toHaveLength(3);
    expect(JSON.parse(entries[0]!.after as string)).toEqual({ hasFacsimile: true });
    const log = JSON.stringify(f.deps.db.select().from(schema.auditLog).all());
    expect(log).not.toContain('Jonas');
    expect(log).not.toContain(second.facsimileChecksum!);
  });
});

describe('readFacsimile', () => {
  it('hands the bytes and their type to finance.donationsIssue only', async () => {
    const f = await fixture();
    const signer = unwrap(await saveSigner(f.deps, f.ctx, { validFrom: '2026-01-01', signerName: 'Jonas Feld' }));
    expect(err(await readFacsimile(f.deps, f.ctx, { signerId: signer.id }))).toMatchObject({ type: 'notFound' });
    unwrap(await uploadFacsimile(f.deps, f.ctx, { signerId: signer.id, bytes: jpeg(), mimeType: 'image/jpeg' }));
    const read = unwrap(await readFacsimile(f.deps, f.ctx, { signerId: signer.id }));
    expect(read).toEqual({ bytes: jpeg(), mimeType: 'image/jpeg' });
    expect(err(await readFacsimile(f.deps, ctxWith(['finance.read'], f.userId), { signerId: signer.id }))).toMatchObject({ type: 'forbidden', permission: 'finance.donationsIssue' });
    expect(err(await readFacsimile(f.deps, f.ctx, {}))).toMatchObject({ type: 'validation' });
  });
});

describe('machine procedure status', () => {
  it('status is complete only with a current signer, a facsimile and a notification date', async () => {
    const f = await fixture();
    expect(machineProcedureStatusAt(f.deps.db, '2026-03-01')).toEqual({ complete: false, signer: null, missing: ['signer'] });

    const signer = unwrap(await saveSigner(f.deps, f.ctx, { validFrom: '2026-01-01', validTo: '2026-12-31', signerName: 'Jonas Feld' }));
    expect(machineProcedureStatusAt(f.deps.db, '2026-03-01')).toMatchObject({ complete: false, signer: { id: signer.id }, missing: ['facsimile', 'notifiedOn'] });

    unwrap(await uploadFacsimile(f.deps, f.ctx, { signerId: signer.id, bytes: png(), mimeType: 'image/png' }));
    expect(machineProcedureStatusAt(f.deps.db, '2026-03-01')).toMatchObject({ complete: false, missing: ['notifiedOn'] });

    unwrap(await saveSigner(f.deps, f.ctx, { id: signer.id, validFrom: '2026-01-01', validTo: '2026-12-31', signerName: 'Jonas Feld', notifiedOn: '2026-02-01' }));
    expect(machineProcedureStatusAt(f.deps.db, '2026-03-01')).toMatchObject({ complete: true, signer: { id: signer.id, hasFacsimile: true }, missing: [] });

    // Taggenau: am ersten und letzten Tag vollständig, davor und danach ohne Unterzeichner.
    expect(machineProcedureStatusAt(f.deps.db, '2026-01-01').complete).toBe(true);
    expect(machineProcedureStatusAt(f.deps.db, '2026-12-31').complete).toBe(true);
    expect(machineProcedureStatusAt(f.deps.db, '2025-12-31')).toMatchObject({ complete: false, missing: ['signer'] });
    expect(machineProcedureStatusAt(f.deps.db, '2027-01-01')).toMatchObject({ complete: false, missing: ['signer'] });
  });

  it('getMachineProcedure lists the signers without their storage key, for finance.read', async () => {
    const f = await fixture();
    const signer = unwrap(await saveSigner(f.deps, f.ctx, { validFrom: '2026-01-01', signerName: 'Jonas Feld', notifiedOn: '2026-02-01' }));
    unwrap(await uploadFacsimile(f.deps, f.ctx, { signerId: signer.id, bytes: png(), mimeType: 'image/png' }));
    const res = unwrap(await getMachineProcedure(f.deps, ctxWith(['finance.read'], f.userId)));
    expect(res.status).toMatchObject({ complete: true, missing: [] });
    expect(res.signers).toEqual([expect.objectContaining({ id: signer.id, signerName: 'Jonas Feld', hasFacsimile: true, state: 'current' })]);
    expect(res.signers[0]).not.toHaveProperty('facsimileKey');
    expect(err(await getMachineProcedure(f.deps, ctxWith(['finance.overview'], f.userId)))).toMatchObject({ type: 'forbidden', permission: 'finance.read' });
  });
});

describe('createNotificationLetterDraft', () => {
  it('creates the notification letter as a draft of the archive, or names who has dms.create', async () => {
    const f = await fixture();
    ensureLetterType(f);
    unwrap(await saveNotice(f.deps, f.ctx, exemption));
    const signer = unwrap(await saveSigner(f.deps, f.ctx, { validFrom: '2026-01-01', signerName: 'Jonas Feld' }));

    // Ohne dms.create: forbidden mit dem Recht — die Oberfläche nennt dann, wer es hat.
    const denied = await createNotificationLetterDraft(f.deps, f.ctx, { signerId: signer.id });
    expect(err(denied)).toMatchObject({ type: 'forbidden', permission: 'dms.create' });
    const roleId = insertRole(f.deps, { name: 'Schreibt Briefe' });
    f.deps.db.insert(schema.rolePermissions).values({ roleId, permissionKey: 'dms.create' }).run();
    insertUser(f.deps, { name: 'Briefe Person', email: 'briefe@example.org', id: 'LETTERS' });
    f.deps.db.insert(schema.userRoles).values({ userId: 'LETTERS', roleId }).run();
    expect(listUserNamesWithPermission(f.deps, 'dms.create')).toContain('Briefe Person');

    const ctx = ctxWith([...FINANCE_PERMISSIONS, 'dms.create', 'dms.view'], f.userId);
    const draft = unwrap(await createNotificationLetterDraft(f.deps, ctx, { signerId: signer.id }));
    const row = f.deps.db.select().from(documents).where(eq(documents.id, draft.id)).get()!;
    expect(row).toMatchObject({ phase: 'draft', typeKey: 'letter' });
    // Der Betreff geht ins Protokoll der Akte — er nennt weder Finanzamt noch Steuernummer noch Namen.
    expect(row.subject).not.toMatch(/Musterstadt|99\/999|Jonas/);
    expect(row.draftBody).toContain('Finanzamt Musterstadt');
    expect(row.draftBody).toContain('99/999/99999');
    expect(row.draftBody).toContain('Jonas Feld');
    expect(row.draftBody).toContain('R 10b.1 Abs. 4 EStR');
    expect(row.draftBody).toContain('Faksimile');
    expect(JSON.stringify(auditOf(f, 'dms.draft.create'))).not.toMatch(/Musterstadt|99\/999|Jonas/);
  });

  it('needs finance.donationsIssue, a known signer and a notice to address', async () => {
    const f = await fixture();
    ensureLetterType(f);
    const ctx = ctxWith([...FINANCE_PERMISSIONS, 'dms.create', 'dms.view'], f.userId);
    const signer = unwrap(await saveSigner(f.deps, f.ctx, { validFrom: '2026-01-01', signerName: 'Jonas Feld' }));
    expect(err(await createNotificationLetterDraft(f.deps, ctxWith(['finance.read', 'dms.create'], f.userId), { signerId: signer.id }))).toMatchObject({ type: 'forbidden', permission: 'finance.donationsIssue' });
    expect(err(await createNotificationLetterDraft(f.deps, ctx, {}))).toMatchObject({ type: 'validation' });
    expect(err(await createNotificationLetterDraft(f.deps, ctx, { signerId: 'nope' }))).toMatchObject({ type: 'notFound' });
    expect(err(await createNotificationLetterDraft(f.deps, ctx, { signerId: signer.id }))).toMatchObject({ type: 'conflict', code: 'noNoticeValidAt' });
    // Ein irrtümlich erfasster Bescheid adressiert nichts.
    const notice = unwrap(await saveNotice(f.deps, f.ctx, exemption));
    unwrap(await voidNotice(f.deps, f.ctx, { id: notice.id, note: 'falsch' }));
    expect(err(await createNotificationLetterDraft(f.deps, ctx, { signerId: signer.id }))).toMatchObject({ type: 'conflict', code: 'noNoticeValidAt' });
  });
});

describe('wording.notificationLetter', () => {
  it('names the association, the procedure, the signer and the facsimile, in the Sie form of a letter', () => {
    const text = notificationLetter('Jonas Feld', null, { organizationName: 'Beispielverein e. V.', taxOffice: 'Finanzamt Musterstadt', taxNumber: '99/999/99999' });
    expect(text).toContain('Beispielverein e. V.');
    expect(text).toContain('Jonas Feld');
    expect(text).toContain('Faksimile');
    expect(text).toContain('maschinell');
    expect(text).toContain('R 10b.1 Abs. 4 EStR');
    expect(text).toMatch(/Sehr geehrte Damen und Herren/);
    expect(text).not.toMatch(/\bdu\b|\bdein/i);
    // Ist die Anzeige schon vermerkt, nennt der Brief ihr Datum (deutsch).
    expect(notificationLetter('Jonas Feld', '01.02.2026')).toContain('01.02.2026');
  });
});

describe('machine status purity', () => {
  it('imports nothing — no @kompass/*, no relative path', () => {
    const source = readFileSync(path.resolve(import.meta.dirname, '../src/ledger/machine-status.ts'), 'utf8');
    const imports = [...source.matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)].map((m) => m[1]!);
    expect(imports).toEqual([]);
  });
});
