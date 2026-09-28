import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
 * geprüft; hier nur, dass er im PDF ankommt. Seit 2026-09-27 mit der
 * Anschriftzone der Formular-Basis (Fensterumschlag DIN lang): Die Anschrift
 * steht im Fenster, und die Bestätigung bleibt trotzdem eine Seite (BMF Nr. 2).
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
  // Weiche Trennstellen (U+00AD) im Betrag in Worten und Trennungen aus dem Blocksatz fallen für den Wortlautvergleich weg.
  return out.stdout.replace(/\u00AD\s*/g, '').replace(/\s+/g, ' ');
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
    // Die eigene Basis trägt kein Kennzeichen: Aussteller und Zuwendender stehen im Körper.
    expect(ownText).toContain('Name und Anschrift des Zuwendenden: Erika Musterfrau');
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

const MM = 25.4 / 72;
/** Oberkante eines Wortes in Millimetern und seine Seite — aus `pdftotext -bbox`. */
function wordAt(bytes: Uint8Array, word: string): { x: number; y: number; page: number } {
  const dir = mkdtempSync(path.join(tmpdir(), 'kompass-zwb-'));
  dirs.push(dir);
  writeFileSync(path.join(dir, 'x.pdf'), bytes);
  const out = spawnSync('pdftotext', ['-bbox', path.join(dir, 'x.pdf'), '-'], { encoding: 'utf8' });
  if (out.status !== 0) throw new Error(`pdftotext: ${out.stderr}`);
  let page = 0;
  for (const line of out.stdout.split('\n')) {
    if (line.includes('<page ')) page += 1;
    const m = /<word xMin="([\d.]+)" yMin="([\d.]+)"[^>]*>([^<]*)<\/word>/.exec(line);
    if (m && m[3] === word) return { x: Number(m[1]) * MM, y: Number(m[2]) * MM, page };
  }
  throw new Error(`word not found: ${word}`);
}
// Im Anschriftfeld nach DIN 5008 Form B: 20–105 mm von links, 45–90 mm von oben (pdftotext misst den Kegel, knapp 2 mm über der Satzkante).
const inWindow = (w: { x: number; y: number; page: number }) => w.page === 1 && w.x > 20 && w.x < 105 && w.y > 43 && w.y < 90;

/** Vierzeilige Anschrift unter dem Namen — das Höchstmaß des Schemas. */
const fourLines = { name: 'Erika Musterfrau', addressLines: ['c/o Beispiel GmbH', 'Beispielstraße 7', 'Hinterhaus', '54321 Beispielstadt'] };
const OLD_BASE = path.resolve(import.meta.dirname, '../../../packages/documents/tests/fixtures/a4-formular-ohne-anschriftzone.typ');

/** Luft zwischen dem letzten Wort des Körpers und dem Ende des Satzspiegels (297 − 22 mm) auf Seite 1, in mm. */
function reserve(bytes: Uint8Array): number {
  const dir = mkdtempSync(path.join(tmpdir(), 'kompass-zwb-'));
  dirs.push(dir);
  writeFileSync(path.join(dir, 'x.pdf'), bytes);
  const page1 = spawnSync('pdftotext', ['-bbox', path.join(dir, 'x.pdf'), '-'], { encoding: 'utf8' }).stdout.split('</page>')[0]!;
  const bottoms = [...page1.matchAll(/yMax="([\d.]+)">[^<]*</g)].map((m) => Number(m[1]) * MM).filter((y) => y < 275);
  return 275 - Math.max(...bottoms);
}
const txt = (n: number, c: string) => c.repeat(Math.ceil(n / c.length)).slice(0, n);

describe('window envelope: address zone of the form base (Plan 2026-09-27)', () => {
  it('money with a four-line address, machine note and facsimile stays on one page with 10 mm to spare, the donor in the window', async () => {
    const m = await render('finance-confirmation-money', { ...money, recipient: fourLines });
    expect(m.pages).toBe(1);
    expect(reserve(m.bytes)).toBeGreaterThanOrEqual(10);
    expect(inWindow(wordAt(m.bytes, 'Erika'))).toBe(true);
    expect(inWindow(wordAt(m.bytes, 'Beispielstadt'))).toBe(true);
    const text = pdfText(m.bytes);
    for (const s of ['Name und Anschrift des Zuwendenden:', 'Aussteller (Bezeichnung und Anschrift der steuerbegünstigten Einrichtung)', 'ohne eigenhändige Unterschrift gültig', 'Seite 1 von 1']) expect(text).toContain(s);
    // Der Titel beginnt unter dem Anschriftfeld (45–90 mm), bei 94 mm.
    expect(wordAt(m.bytes, 'Bestätigung').y).toBeGreaterThan(92);
  });

  it('collective with a four-line address, machine note and facsimile: the confirmation complete on page 1 with 10 mm to spare, the attachment on page 2', async () => {
    const worst = {
      ...collective, recipient: fourLines, membershipFeesCertifiable: false, machine: true, machineNotifiedOn: '2026-01-10',
      facsimile: { bytes: PNG, checksum: 'f'.repeat(64), mimeType: 'image/png' },
      lines: collective.lines.map((l) => ({ ...l, kind: 'donation', expenseWaiver: false })),
    };
    const c = await render('finance-confirmation-collective', worst);
    expect(c.pages).toBe(2);
    expect(reserve(c.bytes)).toBeGreaterThanOrEqual(10);
    expect(inWindow(wordAt(c.bytes, 'Erika'))).toBe(true);
    const text = pdfText(c.bytes);
    expect(text).toContain('Seite 1 von 2');
    expect(text).toContain('ohne eigenhändige Unterschrift gültig');
    // Seite 1 endet mit dem Gültigkeitshinweis (§ 63 Abs. 5 AO), die Anlage beginnt auf Seite 2.
    expect(wordAt(c.bytes, 'zurückliegt').page).toBe(1);
    expect(wordAt(c.bytes, '15.01.2026').page).toBe(2);
  });

  it('in-kind stays without the zone: the donor in the box under the title', async () => {
    const k = await render('finance-confirmation-in-kind', { ...inKind, recipient: fourLines });
    expect(k.pages).toBe(1);
    expect(reserve(k.bytes)).toBeGreaterThanOrEqual(10);
    expect(wordAt(k.bytes, 'Erika').y).toBeGreaterThan(wordAt(k.bytes, 'Bestätigung').y);
  });

  it('in-kind at the schema limits (500/500/1000) runs onto a second page — the issue service refuses it; 200/200/400 fits since the tighter spacing', async () => {
    const long = (item: number, condition: number, valuation: number) => ({ ...inKind, recipient: fourLines, item: txt(item, 'Hundebox Alu '), condition: txt(condition, 'gebraucht gut '), valuation: txt(valuation, 'Kaufpreis laut Rechnung ') });
    expect((await render('finance-confirmation-in-kind', long(500, 500, 1000))).pages).toBeGreaterThan(1);
    expect((await render('finance-confirmation-in-kind', long(200, 200, 400))).pages).toBe(1);
  });

  it('falls back to the head in the body on an own form base without the zone', async () => {
    const vol = mkdtempSync(path.join(tmpdir(), 'kompass-vol-'));
    dirs.push(vol);
    copyFileSync(OLD_BASE, path.join(vol, 'a4-formular.typ'));
    const m = await render('finance-confirmation-money', { ...money, recipient: fourLines }, vol);
    expect(m.pages).toBe(1);
    const text = pdfText(m.bytes);
    for (const s of ['Name und Anschrift des Zuwendenden:', 'Aussteller (Bezeichnung und Anschrift der steuerbegünstigten Einrichtung)', 'Erika Musterfrau', '54321 Beispielstadt']) expect(text).toContain(s);
    // Ohne Zone steht die Anschrift im Kasten unter dem Titel, nicht im Fenster.
    expect(wordAt(m.bytes, 'Erika').y).toBeGreaterThan(wordAt(m.bytes, 'Bestätigung').y);
  });

  it('the waiver declaration goes to the claimant in the window, on one page with 10 mm to spare', async () => {
    const t = template('finance-waiver-declaration');
    const input = {
      organization: { name: 'Musterverein e.V.', addressLines: ['Musterweg 1', '12345 Musterstadt'] },
      claimant: { name: 'Hanna Helferin', addressLines: ['c/o Beispiel GmbH', 'Beispielstraße 7', 'Hinterhaus', '54321 Beispielstadt'] },
      claimNumber: 'KE-2026-001', amountCents: 4519, basisText: 'Satzung § 7 Abs. 2', agreedOn: '2026-01-02', declaredOn: '2026-09-05', place: 'Musterstadt',
    };
    const built: DocumentBuildResult = t.build(t.schema.parse(input), { ...context, number: 'VZE-2026-001' });
    const out = await createDocumentEngine({ documentTemplatesDir: null }).render({ baseId: t.base, bodyTypst: 'typst' in built.body ? built.body.typst : '', slots: built.slots, context: { ...context, number: 'VZE-2026-001' } });
    expect(out.pages).toBe(1);
    expect(reserve(out.bytes)).toBeGreaterThanOrEqual(10);
    expect(inWindow(wordAt(out.bytes, 'Hanna'))).toBe(true);
    const text = pdfText(out.bytes);
    for (const s of ['Verzichtende Person', 'Verein', 'Verzichtserklärung', 'Unterschrift der verzichtenden Person']) expect(text).toContain(s);
  });
});
