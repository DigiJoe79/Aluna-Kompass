import type { DocumentRenderContext, DocumentTemplate } from '@kompass/core';
import { DEFAULT_THEME } from '@kompass/core/themes';
import { describe, expect, it } from 'vitest';
import { collectiveConfirmationTemplate } from '../src/donations/templates/collective';
import { inKindConfirmationTemplate } from '../src/donations/templates/in-kind';
import { moneyConfirmationTemplate } from '../src/donations/templates/money';
import { CONFIRMATION_TEMPLATE_KEYS, typstText, yesNoBoxes } from '../src/donations/templates/shared';
import * as W from '../src/donations/templates/wording';
import { financeModule } from '../src/manifest';

const ctx: DocumentRenderContext = { number: 'ZWB-2026-001', issuedAt: '2026-03-20T12:00:00.000Z', organization: { 'organization.name': 'Musterverein e.V.' }, theme: DEFAULT_THEME, logo: null };
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
const FACSIMILE = { bytes: PNG, checksum: 'f'.repeat(64), mimeType: 'image/png' as const };

const common = {
  organization: { name: 'Musterverein e.V.', addressLines: ['Musterweg 1', '12345 Musterstadt'] },
  recipient: { name: 'Erika Musterfrau', addressLines: ['Beispielstraße 7', '54321 Beispielstadt'] },
  notice: { kind: 'exemptionNotice' as const, taxOffice: 'Musterstadt-Nord', taxNumber: '12/345/67890', noticeDate: '2025-06-30', assessmentPeriod: '2021–2023', purposesText: 'des Tierschutzes' },
  place: 'Musterstadt',
  issuedOn: '2026-03-20',
  machine: false,
  signerName: 'Max Beispiel',
  machineNotifiedOn: null,
};
const money = { ...common, membershipFeesCertifiable: true, amountCents: 11919, donatedOn: '2026-02-14', expenseWaiver: false };
const machine = { machine: true, signerName: 'Max Beispiel', machineNotifiedOn: '2026-01-10', facsimile: FACSIMILE };
const inKind = { ...common, amountCents: 25000, donatedOn: '2026-02-14', item: 'Hundebox aus Aluminium, Größe L', condition: 'gebraucht, zwei Jahre alt, guter Zustand', valuation: 'Kaufpreis 2024 laut Rechnung 390 €, abzüglich Gebrauch', origin: 'private' as const, withdrawalValueCents: null, vatCents: null };
const collective = {
  ...money,
  periodFrom: '2026-01-01',
  periodTo: '2026-12-31',
  lines: [
    { donatedOn: '2026-01-15', kind: 'donation' as const, expenseWaiver: false, amountCents: 5000 },
    { donatedOn: '2026-03-01', kind: 'membershipFee' as const, expenseWaiver: false, amountCents: 3600 },
    { donatedOn: '2026-05-20', kind: 'donation' as const, expenseWaiver: true, amountCents: 12050 },
  ],
};

/** Parse wie `prepare`: Die Vorlage bekommt nur geprüfte Daten. */
function build<T>(template: DocumentTemplate<T>, input: unknown) {
  const parsed = template.schema.safeParse(input);
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
  const built = template.build(parsed.data, ctx);
  return { ...built, typst: 'typst' in built.body ? built.body.typst : '' };
}
const refuses = (template: DocumentTemplate<unknown>, input: unknown) => !template.schema.safeParse(input).success;
const t = (s: string) => typstText(s);

describe('donation templates: registration', () => {
  it('registers three filed templates on the form base under finance.donationsIssue', () => {
    const registered = (financeModule.documentTemplates ?? []).filter((x) => x.type === 'finance-confirmation');
    expect(registered.map((x) => x.key).sort()).toEqual([...CONFIRMATION_TEMPLATE_KEYS].sort());
    expect(CONFIRMATION_TEMPLATE_KEYS).toEqual(['finance-confirmation-money', 'finance-confirmation-in-kind', 'finance-confirmation-collective']);
    for (const template of registered) {
      expect(template).toMatchObject({ type: 'finance-confirmation', base: 'a4-formular', permission: 'finance.donationsIssue' });
      expect(template.filed).not.toBe(false);
    }
  });
});

describe('money confirmation', () => {
  it('money template carries the mandatory sentences in both positions of the membership switch', () => {
    const no = build(moneyConfirmationTemplate, { ...money, membershipFeesCertifiable: false });
    const yes = build(moneyConfirmationTemplate, money);
    for (const b of [no, yes]) {
      expect(b.slots).toEqual({ kind: 'form', title: W.TITLE_MONEY });
      expect(b.typst).toContain(t(W.TITLE_MONEY));
      expect(b.typst).toContain(t(W.SUBTITLE));
      expect(b.typst).toContain(t(W.DONOR_LABEL));
      expect(b.typst).toContain(t('einhundertneunzehn Euro und neunzehn Cent'));
      expect(b.typst).toContain(t('119,19 €'));
      expect(b.typst).toContain(t('14.02.2026'));
      expect(b.typst).toContain(t(W.WAIVER_SENTENCE));
      expect(b.typst).toContain(t(W.usageSentence('des Tierschutzes')));
      expect(b.typst).toContain(t(W.LIABILITY_NOTE));
      expect(b.typst).toContain(t(W.VALIDITY_NOTE));
    }
    expect(no.typst).toContain(t(W.MEMBERSHIP_HEADING));
    expect(no.typst).toContain(t(W.MEMBERSHIP_SENTENCE));
    expect(yes.typst).not.toContain(t(W.MEMBERSHIP_SENTENCE));
  });

  it('names the notice by its kind, with tax office, number and date', () => {
    const exemption = build(moneyConfirmationTemplate, money).typst;
    expect(exemption).toContain(t(W.noticeSentence({ ...common.notice, noticeDate: '30.06.2025' })));
    expect(exemption).toContain('Freistellungsbescheid des Finanzamtes Musterstadt-Nord, StNr. 12/345/67890, vom 30.06.2025 für den letzten Veranlagungszeitraum 2021–2023');

    const attachment = build(moneyConfirmationTemplate, { ...money, notice: { ...common.notice, kind: 'corporateTaxNoticeAttachment' } }).typst;
    expect(attachment).toContain('nach der Anlage zum Körperschaftsteuerbescheid des Finanzamtes Musterstadt-Nord');
    expect(attachment).not.toContain('Freistellungsbescheid des');

    const provisional = build(moneyConfirmationTemplate, { ...money, notice: { ...common.notice, kind: 'section60a', assessmentPeriod: null, purposesTextAccusative: 'den Tierschutz' } }).typst;
    expect(provisional).toContain('mit Bescheid vom 30.06.2025 nach § 60a AO gesondert festgestellt');
    // N8: der § 60a-Satz braucht den Akkusativ, nicht den Genitiv von `notice.purposesText`.
    expect(provisional).toContain('Wir fördern nach unserer Satzung den Tierschutz');
    expect(provisional).not.toContain('Wir fördern nach unserer Satzung des Tierschutzes');
  });

  it('expense waiver adds the waiver sentence', () => {
    const plain = build(moneyConfirmationTemplate, money).typst;
    const waiver = build(moneyConfirmationTemplate, { ...money, expenseWaiver: true }).typst;
    expect(plain).toContain(yesNoBoxes(false));
    expect(waiver).toContain(yesNoBoxes(true));
    expect(yesNoBoxes(true)).not.toBe(yesNoBoxes(false));
  });

  it('the machine notice and facsimile appear only when machine is true', () => {
    const signed = build(moneyConfirmationTemplate, money);
    expect(signed.images).toBeUndefined();
    expect(signed.typst).not.toContain('/images/signature');
    expect(signed.typst).not.toContain(t(W.machineNote('Musterstadt-Nord', '10.01.2026')));
    expect(signed.typst).toContain(t(W.SIGNATURE_CAPTION));

    const auto = build(moneyConfirmationTemplate, { ...money, ...machine });
    expect(auto.images).toEqual({ signature: { bytes: PNG, checksum: 'f'.repeat(64) } });
    expect(auto.typst).toContain('#image("/images/signature.png"');
    expect(auto.typst).toContain(t(W.machineNote('Musterstadt-Nord', '10.01.2026')));

    // N11 (Befundliste 0.2.0): das Faksimile steht rechts, über dem Namen — dieselbe Kante wie `#h(1fr)` vor dem Namen in der Zeile mit der Bildunterschrift.
    expect(auto.typst).toContain('#grid(columns: (70mm, 1fr), align: (left + bottom, right + bottom)');
    expect(auto.typst).not.toContain('align: (left + bottom, left + bottom)');
    expect(auto.typst).toContain('#image("/images/signature.png", height: 16mm)');
    expect(auto.typst).toContain('#h(1fr)');

    // Faksimile ohne maschinelles Verfahren, oder maschinell ohne Faksimile, Anzeige oder Unterzeichner: die Vorlage lehnt ab.
    expect(refuses(moneyConfirmationTemplate as DocumentTemplate<unknown>, { ...money, facsimile: FACSIMILE })).toBe(true);
    expect(refuses(moneyConfirmationTemplate as DocumentTemplate<unknown>, { ...money, ...machine, facsimile: undefined })).toBe(true);
    expect(refuses(moneyConfirmationTemplate as DocumentTemplate<unknown>, { ...money, ...machine, machineNotifiedOn: null })).toBe(true);
    expect(refuses(moneyConfirmationTemplate as DocumentTemplate<unknown>, { ...money, ...machine, signerName: null })).toBe(true);
  });

  it('an expense waiver is never confirmed by the machine procedure', () => {
    expect(refuses(moneyConfirmationTemplate as DocumentTemplate<unknown>, { ...money, ...machine, expenseWaiver: true })).toBe(true);
  });

  it('refuses a missing assessment period outside section 60a, a zero amount and an empty recipient', () => {
    expect(refuses(moneyConfirmationTemplate as DocumentTemplate<unknown>, { ...money, notice: { ...common.notice, assessmentPeriod: null } })).toBe(true);
    expect(refuses(moneyConfirmationTemplate as DocumentTemplate<unknown>, { ...money, amountCents: 0 })).toBe(true);
    expect(refuses(moneyConfirmationTemplate as DocumentTemplate<unknown>, { ...money, recipient: { name: '', addressLines: [] } })).toBe(true);
  });

  it('treats names and addresses as text, never as markup', () => {
    const hostile = '#panic("x") $x$ [box] *fett* _k_ @ref <l> = Titel\\ "Zitat";';
    const b = build(moneyConfirmationTemplate, { ...money, recipient: { name: hostile, addressLines: ['- Liste', '1. Aufzählung'] } }).typst;
    expect(b).toContain(t(hostile));
    expect(t(hostile)).toBe('#"#panic(\\"x\\") $x$ [box] *fett* _k_ @ref <l> = Titel\\\\ \\"Zitat\\";";');
  });
});

describe('in-kind confirmation', () => {
  it('in-kind template names item, condition, valuation and origin; business origin adds withdrawal value and vat', () => {
    const privately = build(inKindConfirmationTemplate, inKind);
    expect(privately.slots).toEqual({ kind: 'form', title: W.TITLE_IN_KIND });
    expect(privately.typst).toContain(t(W.TITLE_IN_KIND));
    expect(privately.typst).toContain(t(W.IN_KIND_ITEM_LABEL));
    for (const s of [inKind.item, inKind.condition, inKind.valuation]) expect(privately.typst).toContain(t(s));
    expect(privately.typst).toContain(t(W.IN_KIND_ORIGIN_PRIVATE));
    expect(privately.typst).not.toContain(t(W.IN_KIND_ORIGIN_BUSINESS));
    expect(privately.typst).toContain(t(W.IN_KIND_VALUATION_DOCUMENTS));
    expect(privately.typst).toContain(t('zweihundertfünfzig Euro'));
    expect(privately.typst).toContain(t(W.LIABILITY_NOTE));
    // Sachzuwendung: kein Verzicht, kein Mitgliedsbeitrag, immer mit Unterschriftsfeld.
    expect(privately.typst).not.toContain(t(W.WAIVER_SENTENCE));
    expect(privately.typst).not.toContain(t(W.MEMBERSHIP_SENTENCE));
    expect(privately.typst).toContain(t(W.SIGNATURE_CAPTION));

    const business = build(inKindConfirmationTemplate, { ...inKind, origin: 'business', withdrawalValueCents: 21008, vatCents: 3992 }).typst;
    expect(business).toContain(t(W.IN_KIND_ORIGIN_BUSINESS));
    expect(business).not.toContain(t(W.IN_KIND_ORIGIN_PRIVATE));
    expect(business).toContain(t(W.inKindWithdrawal('210,08 €', '39,92 €')));
  });

  it('refuses business origin without withdrawal value and vat, and any machine signature', () => {
    expect(refuses(inKindConfirmationTemplate as DocumentTemplate<unknown>, { ...inKind, origin: 'business' })).toBe(true);
    expect(refuses(inKindConfirmationTemplate as DocumentTemplate<unknown>, { ...inKind, ...machine })).toBe(true);
    expect(refuses(inKindConfirmationTemplate as DocumentTemplate<unknown>, { ...inKind, item: '' })).toBe(true);
  });
});

describe('collective confirmation', () => {
  it('collective template lists the lines in its attachment and sums them', () => {
    const b = build(collectiveConfirmationTemplate, collective);
    expect(b.slots).toEqual({ kind: 'form', title: W.TITLE_COLLECTIVE });
    expect(b.typst).toContain(t(W.TITLE_COLLECTIVE));
    expect(b.typst).toContain(t(W.COLLECTIVE_AMOUNT_LABEL));
    expect(b.typst).toContain(t('01.01.2026 bis 31.12.2026'));
    expect(b.typst).toContain(t('206,50 €'));
    expect(b.typst).toContain(t('zweihundertsechs Euro und fünfzig Cent'));
    expect(b.typst).toContain(t(W.COLLECTIVE_NO_OTHER_CONFIRMATIONS));
    expect(b.typst).toContain(t(W.COLLECTIVE_WAIVER_REFERENCE));
    expect(b.typst).toContain(t(W.ATTACHMENT_TITLE));
    expect(b.typst).toContain(t(W.ATTACHMENT_TOTAL));
    for (const s of ['15.01.2026', '01.03.2026', '20.05.2026', '50,00 €', '36,00 €', '120,50 €', W.ATTACHMENT_KIND_DONATION, W.ATTACHMENT_KIND_MEMBERSHIP_FEE, W.ATTACHMENT_YES, W.ATTACHMENT_NO]) {
      expect(b.typst).toContain(t(s));
    }
    // Die Anlage steht auf einer eigenen Seite.
    expect(b.typst).toContain('#pagebreak()');
  });

  it('refuses lines outside the period, membership fees that are not certifiable, and the machine procedure with a waiver line', () => {
    const c = collectiveConfirmationTemplate as DocumentTemplate<unknown>;
    expect(refuses(c, { ...collective, lines: [{ ...collective.lines[0]!, donatedOn: '2025-12-31' }] })).toBe(true);
    expect(refuses(c, { ...collective, membershipFeesCertifiable: false })).toBe(true);
    expect(refuses(c, { ...collective, ...machine })).toBe(true);
    expect(refuses(c, { ...collective, lines: [] })).toBe(true);
    const noWaiver = { ...collective, ...machine, lines: collective.lines.filter((l) => !l.expenseWaiver) };
    expect(build(collectiveConfirmationTemplate, noWaiver).images?.signature?.checksum).toBe('f'.repeat(64));
  });

  it('the membership sentence follows the switch in the collective confirmation too', () => {
    const lines = collective.lines.filter((l) => l.kind === 'donation');
    expect(build(collectiveConfirmationTemplate, { ...collective, lines, membershipFeesCertifiable: false }).typst).toContain(t(W.MEMBERSHIP_SENTENCE));
    expect(build(collectiveConfirmationTemplate, collective).typst).not.toContain(t(W.MEMBERSHIP_SENTENCE));
  });
});

describe('official wording', () => {
  it('the validity note and the membership sentence follow the official templates (EStH 2020/2023, Anlagen 3, 4, 14)', () => {
    const lines = collective.lines.filter((l) => l.kind === 'donation');
    const collectiveText = build(collectiveConfirmationTemplate, { ...collective, lines, membershipFeesCertifiable: false }).typst;
    // Teilstücke ohne Anführungszeichen: im Typst-Text stehen sie unverändert.
    const texts = [build(moneyConfirmationTemplate, money).typst, build(inKindConfirmationTemplate, inKind).typst, collectiveText];
    for (const text of texts) {
      expect(text).toContain('länger als 3 Jahre seit Ausstellung des Bescheides zurückliegt (§ 63 Abs. 5 AO)');
      expect(text).not.toContain('seit Ausstellung der Bestätigung');
    }
    // Sammelbestätigung mit nicht abziehbaren Mitgliedsbeiträgen: Anlage 14 hat den Singular.
    expect(collectiveText).toContain('nicht um einen Mitgliedsbeitrag handelt, dessen Abzug nach § 10b Abs. 1 des Einkommensteuergesetzes ausgeschlossen ist');
    expect(collectiveText).not.toContain('Mitgliedsbeiträge handelt, deren');
  });
});

describe('official wording: Zweck des Bescheids im Genitiv und im Akkusativ (N8, Befundliste 0.2.0)', () => {
  const base = { taxOffice: 'Beispielstadt', taxNumber: '11/222/33333', noticeDate: '01.09.2026' };
  const genitive = 'des Tierschutzes (§ 52 Abs. 2 Satz 1 Nr. 14 AO)';
  const accusative = 'den Tierschutz (§ 52 Abs. 2 Satz 1 Nr. 14 AO)';

  it('"Wir sind wegen Förderung (Angabe der Zwecke)" — Freistellungsbescheid, Genitiv', () => {
    const sentence = W.noticeSentence({ ...base, kind: 'exemptionNotice', assessmentPeriod: '2023', purposesText: genitive });
    expect(sentence).toContain(`Wir sind wegen Förderung ${genitive} nach dem Freistellungsbescheid`);
  });

  it('"Wir sind wegen Förderung (Angabe der Zwecke)" — Anlage zum Körperschaftsteuerbescheid, Genitiv', () => {
    const sentence = W.noticeSentence({ ...base, kind: 'corporateTaxNoticeAttachment', assessmentPeriod: '2023', purposesText: genitive });
    expect(sentence).toContain(`Wir sind wegen Förderung ${genitive} nach der Anlage zum Körperschaftsteuerbescheid`);
  });

  it('"Wir fördern nach unserer Satzung (Angabe der Zwecke)" — § 60a, Akkusativ (nicht der Genitiv)', () => {
    const sentence = W.noticeSentence({ ...base, kind: 'section60a', assessmentPeriod: null, purposesText: genitive, purposesTextAccusative: accusative });
    expect(sentence).toContain(`Wir fördern nach unserer Satzung ${accusative}.`);
    expect(sentence).not.toContain(genitive);
  });

  it('§ 60a ohne Akkusativform (ältere Daten) weicht auf den Genitiv aus, statt leer zu bleiben', () => {
    const sentence = W.noticeSentence({ ...base, kind: 'section60a', assessmentPeriod: null, purposesText: genitive });
    expect(sentence).toContain(`Wir fördern nach unserer Satzung ${genitive}.`);
  });

  it('"…, dass die Zuwendung nur zur Förderung (Angabe der Zwecke) verwendet wird" — immer der Genitiv, auch bei § 60a', () => {
    expect(W.usageSentence(genitive)).toBe(`Es wird bestätigt, dass die Zuwendung nur zur Förderung ${genitive} verwendet wird.`);
  });
});
