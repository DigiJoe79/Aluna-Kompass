import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DocumentBuildResult, DocumentRenderContext, DocumentTemplate } from '@kompass/core';
import { DEFAULT_THEME } from '@kompass/core/themes';
import { createDocumentEngine } from '@kompass/documents';
import { financeModule } from '@kompass/module-finance';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * Die drei Zuwendungsbestätigungen durch dieselbe Engine wie in der Anwendung
 * (Finanz-Spec 7.3): eine Seite, auch mit überschriebenem Kopf; byte-gleich
 * beim zweiten Lauf; feindliche Namen brechen den Bau nicht. Der Wortlaut
 * selbst ist in `packages/modules/finance/tests/donation-templates.test.ts`
 * geprüft; hier nur, dass er im PDF ankommt.
 */
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const context: DocumentRenderContext = {
  number: 'ZWB-2026-001',
  issuedAt: '2026-03-20T12:00:00.000Z',
  organization: { 'organization.name': 'Musterverein e.V.', 'organization.street': 'Musterweg 1', 'organization.postalCode': '12345', 'organization.city': 'Musterstadt' },
  theme: DEFAULT_THEME,
  logo: null,
};
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
const common = {
  organization: { name: 'Musterverein e.V.', addressLines: ['Musterweg 1', '12345 Musterstadt'] },
  recipient: { name: 'Erika Musterfrau', addressLines: ['Beispielstraße 7', '54321 Beispielstadt'] },
  notice: { kind: 'exemptionNotice', taxOffice: 'Musterstadt-Nord', taxNumber: '12/345/67890', noticeDate: '2025-06-30', assessmentPeriod: '2021–2023', purposesText: 'des Tierschutzes (§ 52 Abs. 2 Satz 1 Nr. 14 AO)' },
  place: 'Musterstadt',
  issuedOn: '2026-03-20',
  signerName: 'Max Beispiel',
};
const money = { ...common, membershipFeesCertifiable: false, amountCents: 11919, donatedOn: '2026-02-14', expenseWaiver: false, machine: true, machineNotifiedOn: '2026-01-10', facsimile: { bytes: PNG, checksum: 'f'.repeat(64), mimeType: 'image/png' } };
const inKind = { ...common, machine: false, machineNotifiedOn: null, amountCents: 25000, donatedOn: '2026-02-14', item: 'Hundebox aus Aluminium, Größe L', condition: 'gebraucht, zwei Jahre alt', valuation: 'Kaufpreis laut Rechnung abzüglich Gebrauch', origin: 'business', withdrawalValueCents: 21008, vatCents: 3992 };
const collective = {
  ...common, machine: false, machineNotifiedOn: null, membershipFeesCertifiable: true, periodFrom: '2026-01-01', periodTo: '2026-12-31',
  lines: Array.from({ length: 12 }, (_, i) => ({ donatedOn: `2026-${String(i + 1).padStart(2, '0')}-15`, kind: i === 0 ? 'membershipFee' : 'donation', expenseWaiver: i === 5, amountCents: 1000 + i * 250 })),
};

const template = (key: string) => (financeModule.documentTemplates ?? []).find((t) => t.key === key) as DocumentTemplate;

async function render(key: string, input: unknown, documentTemplatesDir: string | null = null) {
  const t = template(key);
  const parsed = t.schema.safeParse(input);
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
  const built: DocumentBuildResult = t.build(parsed.data, context);
  const bodyTypst = 'typst' in built.body ? built.body.typst : '';
  return createDocumentEngine({ documentTemplatesDir }).render({ baseId: t.base, bodyTypst, slots: built.slots, context, images: built.images });
}

function pdfText(bytes: Uint8Array): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'kompass-zwb-'));
  dirs.push(dir);
  writeFileSync(path.join(dir, 'x.pdf'), bytes);
  const out = spawnSync('pdftotext', ['-layout', path.join(dir, 'x.pdf'), '-'], { encoding: 'utf8' });
  if (out.status !== 0) throw new Error(`pdftotext: ${out.stderr}`);
  return out.stdout.replace(/\s+/g, ' ');
}

describe('donation confirmation templates render', () => {
  it('money and in-kind fit on one page, the collective confirmation adds its attachment page', async () => {
    const m = await render('finance-confirmation-money', money);
    expect(m.pages).toBe(1);
    const text = pdfText(m.bytes);
    expect(text).toContain('Bestätigung über Geldzuwendungen/Mitgliedsbeitrag');
    expect(text).toContain('einhundertneunzehn Euro und neunzehn Cent');
    expect(text).toContain('ohne eigenhändige Unterschrift gültig');
    expect(text).toContain('ZWB-2026-001');
    expect(text).toContain('Seite 1 von 1');
    expect((await render('finance-confirmation-in-kind', inKind)).pages).toBe(1);
    const c = await render('finance-confirmation-collective', collective);
    expect(c.pages).toBe(2);
    expect(pdfText(c.bytes)).toContain('Anlage zur Sammelbestätigung');
  });

  it('renders one page with an overridden head (volume base a4-formular) and keeps the body', async () => {
    const vol = mkdtempSync(path.join(tmpdir(), 'kompass-vol-'));
    dirs.push(vol);
    writeFileSync(
      path.join(vol, 'a4-formular.typ'),
      '#let base(payload, slots, body) = { set document(date: none); set text(font: payload.brand.fontBody, size: 10pt); set page(paper: "a4", margin: (top: 40mm, bottom: 22mm, x: 20mm), header: [#text(size: 16pt)[Eigener Vereinskopf]]); body }\n',
    );
    const shipped = await render('finance-confirmation-money', money);
    const own = await render('finance-confirmation-money', money, vol);
    expect(own.pages).toBe(1);
    const ownText = pdfText(own.bytes);
    expect(ownText).toContain('Eigener Vereinskopf');
    // Der Körper — der amtliche Wortlaut — bleibt derselbe.
    for (const sentence of ['Es wird bestätigt, dass es sich nicht um einen Mitgliedsbeitrag handelt', 'haftet für die entgangene Steuer', 'nach dem Freistellungsbescheid des Finanzamtes Musterstadt-Nord']) {
      expect(pdfText(shipped.bytes)).toContain(sentence);
      expect(ownText).toContain(sentence);
    }
  });

  it('renders byte-identical twice', async () => {
    for (const [key, input] of [['finance-confirmation-money', money], ['finance-confirmation-in-kind', inKind], ['finance-confirmation-collective', collective]] as const) {
      const a = await render(key, input);
      const b = await render(key, input);
      expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
    }
  });

  it('renders the simplified receipt (F6b) on one page without a number, with notice sentence and limit', async () => {
    const t = template('finance-simplified-receipt');
    const parsed = t.schema.parse({ organization: common.organization, notice: common.notice, limitCents: 30000 });
    const built: DocumentBuildResult = t.build(parsed, { ...context, number: '' });
    const bodyTypst = 'typst' in built.body ? built.body.typst : '';
    const out = await createDocumentEngine({ documentTemplatesDir: null }).render({ baseId: t.base, bodyTypst, slots: built.slots, context: { ...context, number: '' }, images: built.images });
    expect(out.pages).toBe(1);
    const text = pdfText(out.bytes);
    expect(text).toContain('Vereinfachter Zuwendungsnachweis');
    expect(text).toContain('nach dem Freistellungsbescheid des Finanzamtes Musterstadt-Nord');
    expect(text).toContain('Für Zuwendungen bis 300,00 €');
    expect(text).toContain('§ 50 Abs. 4 EStDV');
    expect(text).not.toContain('ZWB-');
  });

  it('builds with hostile names and texts', async () => {
    const hostile = 'Zusage; "Anführung" | #panic("x") $x$ @label [box] ~ C:\\temp *fett* _k_ <l>';
    const out = await render('finance-confirmation-in-kind', { ...inKind, recipient: { name: hostile, addressLines: ['- Liste', '= Titel', '1. Aufzählung'] }, item: hostile, condition: '/ term: x', valuation: '```code```' });
    expect(pdfText(out.bytes)).toContain('#panic("x")');
  });
});
