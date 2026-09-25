import { schema, unwrap, type Deps } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { documents } from '@kompass/module-dms';
import { describe, expect, it } from 'vitest';
import { readSimplifiedReceipt } from '../src/donations/book';
import { germanDate, typstText } from '../src/donations/templates/shared';
import { SIMPLIFIED_RECEIPT_TEMPLATE_KEY, simplifiedReceiptTemplate } from '../src/donations/templates/simplified';
import * as W from '../src/donations/templates/wording';
import { setDatedValue } from '../src/ledger/dated-values';
import { financeModule } from '../src/manifest';
import { donationFixture, EXEMPTION, type DonationFixture } from './donation-fixture';

type DocumentRenderRequest = Parameters<Deps['documents']['render']>[0];

/** Die Eingabe der Engine mitschreiben — die Attrappe rendert kein Typst. */
function captureRender(f: DonationFixture): DocumentRenderRequest[] {
  const calls: DocumentRenderRequest[] = [];
  const original = f.deps.documents.render;
  f.deps.documents.render = async (request) => {
    calls.push(request);
    return original(request);
  };
  return calls;
}

describe('simplified receipt (§ 50 Abs. 4 EStDV)', () => {
  it('is a form template of its own, not filed, readable with finance.read', () => {
    expect(simplifiedReceiptTemplate).toMatchObject({ key: SIMPLIFIED_RECEIPT_TEMPLATE_KEY, type: 'finance-simplified-receipt', base: 'a4-formular', permission: 'finance.read', filed: false });
    expect(financeModule.documentTemplates).toContain(simplifiedReceiptTemplate);
  });

  it('renders the simplified receipt with the notice sentence and the current limit, files nothing', async () => {
    const f = await donationFixture();
    const calls = captureRender(f);
    const documentsBefore = f.deps.db.select().from(documents).all().length;
    const auditBefore = f.deps.db.select().from(schema.auditLog).all().length;

    const receipt = unwrap(await readSimplifiedReceipt(f.deps, ctxWith(['finance.read'], 'READER')));
    expect(receipt.filename).toBe('Vereinfachter-Zuwendungsnachweis.pdf');
    expect(new TextDecoder().decode(receipt.bytes)).toMatch(/^%PDF/);
    expect(calls).toHaveLength(1);
    const body = calls[0]!.bodyTypst;
    expect(calls[0]!.baseId).toBe('a4-formular');
    expect(body).toContain(typstText(W.SIMPLIFIED_TITLE));
    expect(body).toContain(typstText(W.noticeSentence({ ...EXEMPTION, noticeDate: germanDate(EXEMPTION.noticeDate) })));
    expect(body).toContain(typstText(W.usageSentence(EXEMPTION.purposesText)));
    expect(body).toContain(typstText(W.simplifiedReceiptSentence('300,00 €')));
    expect(body).toContain(typstText(W.SIMPLIFIED_DONATION_SENTENCE));
    expect(body).toContain(typstText('Musterverein e.V.'));
    // Kein Akteneintrag, keine Nummer, kein Protokoll — ein Vordruck ohne Personenbezug.
    expect(f.deps.db.select().from(documents).all()).toHaveLength(documentsBefore);
    expect(f.deps.db.select().from(schema.auditLog).all()).toHaveLength(auditBefore);
  });

  it('takes the limit valid today, including the association’s override', async () => {
    const f = await donationFixture();
    unwrap(await setDatedValue(f.deps, f.ctx, { key: 'simplifiedReceiptLimit', validFrom: '2026-01-01', value: 40000 }));
    unwrap(await setDatedValue(f.deps, f.ctx, { key: 'simplifiedReceiptLimit', validFrom: '2027-01-01', value: 50000 }));
    const calls = captureRender(f);
    unwrap(await readSimplifiedReceipt(f.deps, f.ctx));
    expect(calls[0]!.bodyTypst).toContain(typstText(W.simplifiedReceiptSentence('400,00 €')));
  });

  it('names all elements of the booking confirmation from § 50 Abs. 4 S. 2 EStDV', () => {
    expect(W.simplifiedReceiptSentence('300,00 €')).toContain('den Betrag, den Buchungstag sowie die tatsächliche Durchführung der Zahlung');
  });

  it('refuses without a notice valid today, and without finance.read', async () => {
    const f = await donationFixture({ notice: false });
    expect(await readSimplifiedReceipt(f.deps, f.ctx)).toMatchObject({ ok: false, error: { type: 'conflict', code: 'noNoticeValidAt' } });
    expect(await readSimplifiedReceipt(f.deps, ctxWith([], 'NOBODY'))).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'finance.read' } });
  });
});
