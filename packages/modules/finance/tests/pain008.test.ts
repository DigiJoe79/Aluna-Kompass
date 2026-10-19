import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { schema, unwrap, type CallContext } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { documentLinks, documents, documentTypes } from '@kompass/module-dms';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { buildPain008, type Pain008Run } from '../src/direct-debit/pain008';
import { buildDirectDebitFile, cancelDirectDebitRun, createDirectDebitRun, directDebitFileStream, removeRunItem } from '../src/direct-debit/runs';
import { cancelOpenItem } from '../src/ledger/open-items';
import { financeSepaMandates } from '../src/schema';
import { directDebitFixture } from './direct-debit-fixture';
import { allowHumanOnlyOverMcp } from './helpers';

const XSD = fileURLToPath(new URL('./fixtures/pain.008.001.08.xsd', import.meta.url));

/**
 * Die Datei gegen das offizielle Schema prüfen (`xmllint`). Fehlt `xmllint`, schlägt der Test fehl, statt zu überspringen
 * (wie die Texterkennung, AGENTS.md) — auf macOS ist es dabei, in der CI kommt `libxml2-utils` dazu.
 */
function validate(xml: string): { ok: boolean; output: string } {
  const res = spawnSync('xmllint', ['--noout', '--schema', XSD, '-'], { input: xml, encoding: 'utf8' });
  if (res.error) throw new Error(`xmllint fehlt: ${res.error.message}`);
  return { ok: res.status === 0, output: `${res.stdout}${res.stderr}` };
}

const run: Pain008Run = {
  messageId: '01JABCDEFGHJKMNPQRSTVWXYZ0',
  createdAt: '2026-10-20T08:00:00.000Z',
  initiatingParty: 'Musterverein e.V.',
  creditor: { name: 'Musterverein e.V.', iban: 'DE23999999990000202051', creditorId: 'DE98ZZZ09999999999' },
  batchBooking: true,
  groups: [
    {
      collectionDate: '2026-10-30',
      sequence: 'recurring',
      items: [
        { endToEndId: '01JABCDEFGHJKMNPQRSTVWXYZ0-1', amountCents: 1200, mandateReference: 'MND-000001', signedOn: '2026-01-15', debtorName: 'Müller & Söhne GmbH', debtorIban: 'DE44999999990532013000', remittance: 'Beitrag 2026 Mitglied 0001' },
        {
          endToEndId: '01JABCDEFGHJKMNPQRSTVWXYZ0-2',
          amountCents: 1550,
          mandateReference: 'MND-000002',
          signedOn: '2025-03-10',
          amendment: { originalIban: 'DE78999999990000300001', since: '2026-10-01' },
          debtorName: 'José Núñez',
          debtorIban: 'DE51999999990000300002',
          remittance: 'Spende 2026-10 für „Sommerfest“ & mehr',
        },
      ],
    },
    {
      collectionDate: '2026-11-02',
      sequence: 'recurring',
      items: [{ endToEndId: '01JABCDEFGHJKMNPQRSTVWXYZ0-3', amountCents: 5, mandateReference: 'MND-000003', signedOn: '2026-02-01', debtorName: 'Erika Beispiel', debtorIban: 'DE24999999990000300003', debtorBic: 'GENODEF1XXX', remittance: 'Spende 2026-11' }],
    },
    {
      collectionDate: '2026-11-02',
      sequence: 'oneOff',
      items: [{ endToEndId: '01JABCDEFGHJKMNPQRSTVWXYZ0-4', amountCents: 10000, mandateReference: 'MND-000004', signedOn: '2026-10-01', amendment: { originalReference: 'ALT-17', since: '2026-10-01' }, debtorName: 'Karl Frühauf', debtorIban: 'DE94999999990000300004', remittance: 'Spende' }],
    },
  ],
};

const between = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g'))].map((m) => m[1]);

describe('buildPain008', () => {
  it('is valid against the official schema pain.008.001.08 — two due days, an amendment, umlauts and special characters (Review Focus 4)', () => {
    const xml = buildPain008(run);
    const result = validate(xml);
    expect(result.output).toContain('validates');
    expect(result.ok).toBe(true);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.08"');
  });

  it('counts and sums per payment and in total; one PmtInf per due day and sequence', () => {
    const xml = buildPain008(run);
    expect(between(xml, 'NbOfTxs')).toEqual(['4', '2', '1', '1']);
    expect(between(xml, 'CtrlSum')).toEqual(['127.55', '27.50', '0.05', '100.00']);
    expect(between(xml, 'ReqdColltnDt')).toEqual(['2026-10-30', '2026-11-02', '2026-11-02']);
    expect(between(xml, 'SeqTp')).toEqual(['RCUR', 'RCUR', 'OOFF']);
    expect(between(xml, 'PmtInfId')).toEqual(['01JABCDEFGHJKMNPQRSTVWXYZ0-P1', '01JABCDEFGHJKMNPQRSTVWXYZ0-P2', '01JABCDEFGHJKMNPQRSTVWXYZ0-P3']);
    expect(between(xml, 'BtchBookg')).toEqual(['true', 'true', 'true']);
    expect(xml).toContain('<InstdAmt Ccy="EUR">12.00</InstdAmt>');
    expect(xml).toContain('<InstdAmt Ccy="EUR">0.05</InstdAmt>');
  });

  it('writes CORE, SLEV, the creditor id, NOTPROVIDED without a BIC, and the amendment with the original account', () => {
    const xml = buildPain008({ ...run, batchBooking: false });
    expect(between(xml, 'BtchBookg')).toEqual(['false', 'false', 'false']);
    expect(between(xml, 'Cd')).toContain('CORE');
    expect(between(xml, 'ChrgBr')).toEqual(['SLEV', 'SLEV', 'SLEV']);
    expect(xml).toContain('<Id>DE98ZZZ09999999999</Id><SchmeNm><Prtry>SEPA</Prtry></SchmeNm>');
    expect(xml).toContain('<CdtrAgt><FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId></CdtrAgt>');
    expect(xml).toContain('<DbtrAgt><FinInstnId><BICFI>GENODEF1XXX</BICFI></FinInstnId></DbtrAgt>');
    expect(xml).toContain('<AmdmntInd>true</AmdmntInd><AmdmntInfDtls><OrgnlDbtrAcct><Id><IBAN>DE78999999990000300001</IBAN></Id></OrgnlDbtrAcct></AmdmntInfDtls>');
    expect(xml).toContain('<AmdmntInfDtls><OrgnlMndtId>ALT-17</OrgnlMndtId></AmdmntInfDtls>');
    expect(between(xml, 'AmdmntInd')).toEqual(['false', 'true', 'false', 'true']);
  });

  it('writes names and remittance in the DK character set', () => {
    const xml = buildPain008(run);
    expect(between(xml, 'Nm')).toEqual(['Musterverein e.V.', 'Musterverein e.V.', 'Müller + Söhne GmbH', 'Jose Nunez', 'Musterverein e.V.', 'Erika Beispiel', 'Musterverein e.V.', 'Karl Frühauf']);
    expect(between(xml, 'Ustrd')).toContain('Spende 2026-10 für Sommerfest + mehr');
    expect(validate(buildPain008({ ...run, creditor: { ...run.creditor, name: `Verein ${'ä'.repeat(100)}` } })).ok).toBe(true);
  });
});

describe('buildDirectDebitFile and directDebitFileStream', () => {
  async function scene() {
    const f = await directDebitFixture();
    const a = await f.payer('Müller', { firstName: 'José' });
    const b = await f.payer('Beispiel');
    const itemA = await f.fee(a, 1200, '2026-10-30');
    const itemB = await f.fee(b, 2500, '2026-10-30', 'Beitrag 2026 Mitglied 0002');
    f.announce(a.mandateId, [{ dueOn: '2026-10-30', amountCents: 1200 }]);
    f.announce(b.mandateId, [{ dueOn: '2026-10-30', amountCents: 2500 }]);
    const run = unwrap(await createDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-10-30' }));
    return { ...f, a, b, itemA, itemB, run };
  }
  const fail = <T>(res: { ok: boolean; error?: T }) => (res.ok ? null : res.error);
  const asMcp = (ctx: CallContext): CallContext => ({ ...ctx, channel: 'mcp' });

  it('writes XML and CSV into the file store, issues the summary into the file and marks the run fileCreated', async () => {
    const f = await scene();
    const built = unwrap(await buildDirectDebitFile(f.deps, f.ctx, { runId: f.run.id }));
    expect(built).toMatchObject({ status: 'fileCreated', count: 2, sumCents: 3700, fileCreatedAt: '2026-10-20T08:00:00.000Z' });
    const xml = unwrap(await directDebitFileStream(f.deps, f.ctx, { runId: f.run.id, kind: 'xml' }));
    expect(xml).toMatchObject({ mimeType: 'application/xml', fileName: 'Lastschrift-2026-10-30.xml' });
    const xmlText = new TextDecoder().decode(xml.bytes);
    expect(validate(xmlText).ok).toBe(true);
    expect(xmlText).toContain(`<MsgId>${f.run.messageId}</MsgId>`);
    expect(xmlText).toContain('<Nm>Jose Müller</Nm>');
    expect(xmlText).toContain(`<IBAN>${f.a.iban}</IBAN>`);
    const csv = unwrap(await directDebitFileStream(f.deps, f.ctx, { runId: f.run.id, kind: 'csv' }));
    expect(csv).toMatchObject({ mimeType: 'text/csv', fileName: 'Lastschrift-2026-10-30.csv' });
    expect(new TextDecoder().decode(csv.bytes.slice(3)).split('\r\n')).toHaveLength(4);

    const doc = f.deps.db.select().from(documents).where(eq(documents.id, built.summaryDocumentId!)).get()!;
    expect(doc).toMatchObject({ typeKey: 'sepa-run-summary', phase: 'issued' });
    expect(f.deps.db.select().from(documentTypes).where(eq(documentTypes.key, 'sepa-run-summary')).get()).toMatchObject({ label: 'Lastschrift-Sammelauftrag', retentionClass: 'statutory10Y', protectionArea: 'finance', ownerModule: 'finance' });
    expect(f.deps.db.select().from(documentLinks).where(and(eq(documentLinks.documentId, doc.id), eq(documentLinks.entityType, 'financeDirectDebitRun'), eq(documentLinks.entityId, f.run.id))).all()).toHaveLength(1);
    expect(doc.inputSnapshot).toContain(f.a.reference);
    expect(doc.inputSnapshot).not.toContain(f.a.iban);
    expect(doc.inputSnapshot).not.toContain('Müller');

    const audit = f.deps.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'finance.directDebit.file')).all();
    expect(audit.map((a) => a.params)).toEqual([JSON.stringify({ collectionOn: '2026-10-30', count: 2 })]);
    expect(fail(await buildDirectDebitFile(f.deps, f.ctx, { runId: f.run.id }))).toMatchObject({ code: 'runFileCreated' });
  });

  it('refuses when a mandate ended in between, naming it; taking the item out helps (Review Focus 3)', async () => {
    const f = await scene();
    f.deps.db.update(financeSepaMandates).set({ endedOn: '2026-10-19', endReason: 'debtor' }).where(eq(financeSepaMandates.id, f.a.mandateId)).run();
    expect(fail(await buildDirectDebitFile(f.deps, f.ctx, { runId: f.run.id }))).toMatchObject({ code: 'mandateEndedInRun', params: { reference: f.a.reference, date: '2026-10-19' } });
    unwrap(await removeRunItem(f.deps, f.ctx, { itemId: f.run.items.find((i) => i.sourceId === f.itemA)!.id }));
    expect(unwrap(await buildDirectDebitFile(f.deps, f.ctx, { runId: f.run.id }))).toMatchObject({ status: 'fileCreated', count: 1, sumCents: 2500 });
  });

  it('refuses when an item is no longer open as it was', async () => {
    const f = await scene();
    unwrap(await cancelOpenItem(f.deps, f.ctx, { id: f.itemB, note: 'falsch' }));
    expect(fail(await buildDirectDebitFile(f.deps, f.ctx, { runId: f.run.id }))).toMatchObject({ code: 'runItemChanged', params: { reference: f.b.reference } });
  });

  it('taking an item out after the file puts the run back to draft and drops the files', async () => {
    const f = await scene();
    unwrap(await buildDirectDebitFile(f.deps, f.ctx, { runId: f.run.id }));
    const after = unwrap(await removeRunItem(f.deps, f.ctx, { itemId: f.run.items[0]!.id }));
    expect(after).toMatchObject({ status: 'draft', fileName: null, fileCreatedAt: null, count: 1 });
    expect(await f.deps.files('finance').exists(`direct-debit-${f.run.id.toLowerCase()}.xml`)).toBe(false);
    expect(fail(await directDebitFileStream(f.deps, f.ctx, { runId: f.run.id, kind: 'xml' }))).toMatchObject({ code: 'runFileMissing' });
    expect((await buildDirectDebitFile(f.deps, f.ctx, { runId: f.run.id })).ok).toBe(true);
  });

  it('is human only and needs finance.directDebit; an agent never gets the file (it holds every IBAN)', async () => {
    const f = await scene();
    expect(fail(await buildDirectDebitFile(f.deps, asMcp(f.ctx), { runId: f.run.id }))).toMatchObject({ code: 'humanOnly' });
    expect(fail(await buildDirectDebitFile(f.deps, ctxWith(['finance.read'], f.userId), { runId: f.run.id }))).toMatchObject({ type: 'forbidden' });
    expect(fail(await buildDirectDebitFile(f.deps, f.ctx, { runId: 'NOPE' }))).toMatchObject({ type: 'notFound' });
    unwrap(await buildDirectDebitFile(f.deps, f.ctx, { runId: f.run.id }));
    allowHumanOnlyOverMcp(f.deps);
    expect(fail(await directDebitFileStream(f.deps, asMcp(f.ctx), { runId: f.run.id, kind: 'xml' }))).toMatchObject({ code: 'fileNotForAgents' });
    expect(fail(await directDebitFileStream(f.deps, ctxWith(['finance.read'], f.userId), { runId: f.run.id, kind: 'xml' }))).toMatchObject({ type: 'forbidden' });
    expect(fail(await directDebitFileStream(f.deps, f.ctx, { runId: f.run.id, kind: 'pdf' }))).toMatchObject({ type: 'validation' });
  });
});

describe('the summary follows the run (L2 Nacharbeit 1)', () => {
  async function built() {
    const f = await directDebitFixture();
    const a = await f.payer('Eins');
    const b = await f.payer('Zwei');
    await f.fee(a, 1200, '2026-10-30');
    await f.fee(b, 2500, '2026-10-30');
    f.announce(a.mandateId, [{ dueOn: '2026-10-30', amountCents: 1200 }]);
    f.announce(b.mandateId, [{ dueOn: '2026-10-30', amountCents: 2500 }]);
    const run = unwrap(await createDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-10-30' }));
    const withFile = unwrap(await buildDirectDebitFile(f.deps, f.ctx, { runId: run.id }));
    const doc = (id: string) => f.deps.db.select().from(documents).where(eq(documents.id, id)).get()!;
    return { ...f, run, summaryId: withFile.summaryDocumentId!, doc };
  }

  it('discarding the run voids its summary with the reason „Einzug verworfen“', async () => {
    const f = await built();
    unwrap(await cancelDirectDebitRun(f.deps, f.ctx, { runId: f.run.id }));
    expect(f.doc(f.summaryId)).toMatchObject({ status: 'voided', voidReason: 'Einzug verworfen' });
  });

  it('taking an item out after the file voids the old summary („Einzug geändert“); the new file brings a new one', async () => {
    const f = await built();
    unwrap(await removeRunItem(f.deps, f.ctx, { itemId: f.run.items[0]!.id }));
    expect(f.doc(f.summaryId)).toMatchObject({ status: 'voided', voidReason: 'Einzug geändert' });
    const again = unwrap(await buildDirectDebitFile(f.deps, f.ctx, { runId: f.run.id }));
    expect(again.summaryDocumentId).not.toBe(f.summaryId);
    expect(f.doc(again.summaryDocumentId!)).toMatchObject({ status: 'issued' });
  });

  it('discarding a run without a file voids nothing', async () => {
    const f = await directDebitFixture();
    const a = await f.payer('Eins');
    await f.fee(a, 1200, '2026-10-30');
    f.announce(a.mandateId, [{ dueOn: '2026-10-30', amountCents: 1200 }]);
    const run = unwrap(await createDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-10-30' }));
    unwrap(await cancelDirectDebitRun(f.deps, f.ctx, { runId: run.id }));
    expect(f.deps.db.select().from(documents).all().filter((d) => d.status === 'voided' && d.typeKey === 'sepa-run-summary')).toEqual([]);
  });
});
