import { isoDay, unwrap, writeSettingInternal, type CallContext, type DocumentRenderContext } from '@kompass/core';
import { DEFAULT_THEME } from '@kompass/core/themes';
import { ctxWith, systemContext } from '@kompass/core/testing';
import { createContact } from '@kompass/module-contacts';
import { documentLinks, documentTypes, documents } from '@kompass/module-dms';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { mandateFormPdf } from '../src/direct-debit/forms';
import { correctMandate, prepareMandate } from '../src/direct-debit/mandates';
import { IBAN_BOXES, MANDATE_AUTHORIZATION, MANDATE_REFUND_NOTE, mandateFormTemplate } from '../src/direct-debit/templates/mandate-form';
import { greetingFor, prenotificationBody, prenotificationTemplate } from '../src/direct-debit/templates/prenotification';
import { formatEuro } from '../src/format/amount';
import { maskIban } from '../src/format/iban';
import { installFinance } from '../src/install';
import { financeModule } from '../src/manifest';
import { typstText as t } from '../src/typst-pure';
import { setupFinance } from './helpers';

const renderCtx: DocumentRenderContext = { number: 'SLM-2026-001', issuedAt: '2026-09-05T12:00:00.000Z', issuedDay: isoDay('2026-09-05'), organization: { 'organization.name': 'Musterverein e.V.' }, theme: DEFAULT_THEME, logo: null };
const IBAN = 'DE44999999990532013000';

const full = {
  creditor: { name: 'Musterverein e.V.', addressLines: ['Musterweg 1', '12345 Musterstadt'], creditorId: 'DE98ZZZ09999999999' },
  reference: 'MND-000001',
  debtor: { name: 'Erika Beispiel', addressLines: ['Beispielstraße 7', '54321 Beispielstadt'], iban: IBAN },
};

function typstOf(data: unknown): string {
  const built = mandateFormTemplate.build(mandateFormTemplate.schema.parse(data), renderCtx);
  return 'typst' in built.body ? built.body.typst : '';
}

const boxes = (typst: string) => typst.match(/#box\(width: 6mm/g)?.length ?? 0;

describe('mandate form template (Handoff D7, 17a)', () => {
  it('is a filed form on the base a4-formular under finance.directDebit, and that base is shipped', () => {
    expect((financeModule.documentTemplates ?? []).find((tp) => tp.key === 'sepa-mandate')).toMatchObject({ type: 'sepa-mandate', base: 'a4-formular', permission: 'finance.directDebit' });
    expect(financeModule.documentBases).toContain('a4-formular');
  });

  it('carries the mandatory text verbatim, creditor id, reference, the payer and the IBAN in 22 boxes', () => {
    const typst = typstOf(full);
    expect(MANDATE_AUTHORIZATION('Musterverein e.V.')).toBe(
      'Ich ermächtige Musterverein e.V., Zahlungen von meinem Konto mittels Lastschrift einzuziehen. Zugleich weise ich mein Kreditinstitut an, die von Musterverein e.V. auf mein Konto gezogenen Lastschriften einzulösen.',
    );
    expect(MANDATE_REFUND_NOTE).toBe('Hinweis: Ich kann innerhalb von acht Wochen, beginnend mit dem Belastungsdatum, die Erstattung des belasteten Betrages verlangen. Es gelten dabei die mit meinem Kreditinstitut vereinbarten Bedingungen.');
    expect(typst).toContain(t(MANDATE_AUTHORIZATION('Musterverein e.V.')));
    expect(typst).toContain(t(MANDATE_REFUND_NOTE));
    for (const text of ['SEPA-Lastschriftmandat', 'DE98ZZZ09999999999', 'MND-000001', 'Wiederkehrende Zahlung', 'Erika Beispiel', 'Beispielstraße 7, 54321 Beispielstadt', 'Ort, Datum', 'Unterschrift', 'Bitte unterschrieben zurück an: Musterverein e.V., Musterweg 1, 12345 Musterstadt · Mandatsreferenz MND-000001']) expect(typst, text).toContain(text);
    expect(boxes(typst)).toBe(IBAN_BOXES);
    expect(typst).toContain(t('D'));
    expect(typst).toContain(t('4'));
  });

  it('builds with empty payer data: empty boxes and lines to write on', () => {
    const typst = typstOf({ ...full, debtor: { name: '', addressLines: [], iban: null } });
    expect(boxes(typst)).toBe(22);
    expect(typst).not.toContain('Erika');
    expect(typst).toContain('#line(length: 100%, stroke: 0.5pt)');
  });

  it('never prints below 10 pt and keeps the signature line at least 60 mm', () => {
    const typst = typstOf(full);
    for (const size of typst.matchAll(/size: (\d+(?:\.\d+)?)pt/g)) expect(Number(size[1])).toBeGreaterThanOrEqual(10);
    expect(typst).toMatch(/#grid\(columns: \(70mm, 1fr\)/);
  });

  it('refuses a creditor id with a wrong check digit', () => {
    expect(mandateFormTemplate.schema.safeParse({ ...full, creditor: { ...full.creditor, creditorId: 'DE98ZZZ09999999998' } }).success).toBe(false);
  });
});

describe('prenotification (Handoff 17b)', () => {
  it('is a letter template of the type sepa-prenotification on the letterhead, and its text holds the data block without a GiroCode', () => {
    expect((financeModule.documentTemplates ?? []).find((tp) => tp.key === 'sepa-prenotification')).toMatchObject({ type: 'sepa-prenotification', base: 'a4-mit-briefkopf' });
    const body = prenotificationBody({ greeting: greetingFor({ kind: 'person', salutation: 'Frau', lastName: 'Beispiel' }), creditorName: 'Musterverein e.V.', amountCents: 1000, interval: 'monthly', firstCollectionOn: '2026-10-15', iban: IBAN, reference: 'MND-000001', creditorId: 'DE98ZZZ09999999999' });
    for (const text of ['Sehr geehrte Frau Beispiel,', `| Betrag | ${formatEuro(1000)} |`, '| Rhythmus | monatlich |', '| Erster Einzug | 15.10.2026 |', '| Mandatsreferenz | MND-000001 |', '| Gläubiger-Identifikationsnummer | DE98ZZZ09999999999 |', maskIban(IBAN)]) expect(body, text).toContain(text);
    expect(body).not.toContain(IBAN);
    expect(body).not.toMatch(/GiroCode|BCD/);
    const built = prenotificationTemplate.build(prenotificationTemplate.schema.parse({ subject: 'Lastschriftankündigung', body, recipient: null }), renderCtx);
    expect(built.body).toEqual({ markdown: body });
    expect(greetingFor({ kind: 'organization', salutation: null, lastName: null })).toBe('Guten Tag,');
  });
});

describe('mandateFormPdf', () => {
  async function setup() {
    const f = setupFinance();
    const write = (key: string, value: unknown) => f.deps.db.transaction((tx) => writeSettingInternal(tx, f.deps, systemContext(), key, value));
    f.deps.db.transaction((tx) => installFinance(tx, f.deps, systemContext()));
    write('organization.name', 'Musterverein e.V.');
    const contactCtx: CallContext = { ...f.ctx, permissions: new Set(['contacts.manage']) };
    const payer = unwrap(await createContact(f.deps, contactCtx, { kind: 'person', firstName: 'Erika', lastName: 'Beispiel', street: 'Beispielstraße 7', postalCode: '54321', city: 'Beispielstadt' }));
    const mandate = unwrap(await prepareMandate(f.deps, f.ctx, { contactId: payer.id, debtorName: 'Erika Beispiel', iban: IBAN }));
    return { ...f, write, mandate };
  }

  it('needs the creditor id first', async () => {
    const f = await setup();
    expect(await mandateFormPdf(f.deps, f.ctx, { mandateId: f.mandate.id })).toMatchObject({ ok: false, error: { code: 'sepaCreditorIdMissing' } });
    expect(await mandateFormPdf(f.deps, ctxWith(['finance.read'], f.userId), { mandateId: f.mandate.id })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
  });

  it('issues the form into the protected area finance as sepa-mandate, linked to the mandate; again only after a change', async () => {
    const f = await setup();
    f.write('finance.sepa.creditorId', 'DE98ZZZ09999999999');
    const first = unwrap(await mandateFormPdf(f.deps, f.ctx, { mandateId: f.mandate.id }));
    expect(first.created).toBe(true);
    const doc = f.deps.db.select().from(documents).where(eq(documents.id, first.documentId)).get()!;
    expect(doc).toMatchObject({ typeKey: 'sepa-mandate', phase: 'issued', subject: 'SEPA-Lastschriftmandat MND-000001' });
    expect(f.deps.db.select().from(documentTypes).where(eq(documentTypes.key, 'sepa-mandate')).get()).toMatchObject({ protectionArea: 'finance', ownerModule: 'finance', retentionClass: 'statutory10Y' });
    expect(f.deps.db.select().from(documentTypes).where(eq(documentTypes.key, 'sepa-prenotification')).get()).toMatchObject({ protectionArea: 'finance', ownerModule: null, retentionClass: 'statutory6Y' });
    expect(f.deps.db.select().from(documentLinks).where(and(eq(documentLinks.documentId, doc.id), eq(documentLinks.entityType, 'financeMandate'), eq(documentLinks.entityId, f.mandate.id))).all()).toHaveLength(1);
    // R10: Der Zahler ist Empfänger — so geht das Formular zur Unterschrift auch per E-Mail.
    expect(f.deps.db.select().from(documentLinks).where(and(eq(documentLinks.documentId, doc.id), eq(documentLinks.entityType, 'contact'), eq(documentLinks.role, 'recipient'))).all().map((l) => l.entityId)).toEqual([f.mandate.contactId]);
    expect(unwrap(await mandateFormPdf(f.deps, f.ctx, { mandateId: f.mandate.id }))).toEqual({ ...first, created: false });
    unwrap(await correctMandate(f.deps, { ...f.ctx }, { mandateId: f.mandate.id, debtorName: 'Erika B. Beispiel' }));
    // Gleiche Uhr im Test: die Korrektur liegt auf demselben Zeitstempel — das neue Formular kommt erst danach.
    f.deps.db.update(documents).set({ createdAt: '2026-09-05T07:00:00.000Z' }).where(eq(documents.id, first.documentId)).run();
    expect(unwrap(await mandateFormPdf(f.deps, f.ctx, { mandateId: f.mandate.id })).created).toBe(true);
  });
});
