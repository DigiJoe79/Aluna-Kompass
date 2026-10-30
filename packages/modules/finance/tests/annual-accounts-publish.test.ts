import { resolvePublishedFile, setModuleEnabled, unwrap, writeSettingInternal } from '@kompass/core';
import { auditEntry, ctxWith, loadAllViews, systemContext } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { saveAssemblyResult } from '../src/closing/assembly';
import { FINANCE_PERMISSIONS, financeModule } from '../src/manifest';
import { publishAnnualAccounts, withdrawAnnualAccounts } from '../src/closing/annual-accounts-publish';
import { signAnnualAccounts } from '../src/closing/annual-accounts-sign';
import { finalizedAnnualAccounts } from './annual-accounts-j2-fixture';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);
type Setup = Awaited<ReturnType<typeof finalizedAnnualAccounts>>;

async function signed(opts: Parameters<typeof finalizedAnnualAccounts>[0] = {}) {
  const s = await finalizedAnnualAccounts(opts);
  const signature = unwrap(await signAnnualAccounts(s.f.deps, s.board.ctx, { reportId: s.report.id }));
  return { ...s, signature };
}
const publish = (s: Setup, extra: Record<string, unknown> = {}) => publishAnnualAccounts(s.f.deps, s.publisher, { reportId: s.report.id, ...extra });
const assembly = (s: Setup, extra: Record<string, unknown> = {}) => saveAssemblyResult(s.f.deps, s.f.ctx, { fiscalYearId: s.y2025, assemblyOn: '2026-03-14', dischargeMode: 'collective', collectiveOutcome: 'granted', ...extra }).then(unwrap);
const view = (s: Setup) => loadAllViews(s.f.deps, financeModule).annualAccounts!;
const approves = (s: Setup) => s.f.deps.db.transaction((tx) => writeSettingInternal(tx, s.f.deps, systemContext(), 'finance.reports.assemblyApprovesAccounts', true));

describe('Jahresrechnung auf der Webseite veröffentlichen', () => {
  it('verlangt die Abzeichnung', async () => {
    const s = await finalizedAnnualAccounts();
    expect(err(await publish(s, { earlyReason: 'itzDeadline' }))).toMatchObject({ code: 'annualAccountsNotSigned' });
  });

  it('verlangt vor der MV einen Grund, protokolliert ihn ohne Notiz', async () => {
    const s = await signed();
    expect(err(await publish(s))).toMatchObject({ code: 'annualAccountsEarlyReasonRequired' });
    expect(err(await publish(s, { earlyReason: 'other' }))).toMatchObject({ type: 'validation' });
    const pub = unwrap(await publish(s, { earlyReason: 'other', earlyNote: 'Förderer fragt nach' }));
    expect(pub).toMatchObject({ reportId: s.report.id, fiscalYearId: s.y2025, earlyReason: 'other', corrected: false, replacesFinalizedAt: null, webVersionOn: null, withdrawnAt: null, withdrawnCause: null, liveSince: null });
    const entry = auditEntry(s.f.deps, 'finance.annualAccounts.publish');
    expect(JSON.parse(entry.params!)).toEqual({ designation: '2025', documentNumber: s.signature.documentNumber, early: true, earlyKind: 'other', corrected: false });
    expect(JSON.stringify(entry)).not.toContain('Förderer');
  });

  it('geht nach eingetragenem MV-Ergebnis ohne Grund', async () => {
    const s = await signed();
    await assembly(s);
    const pub = unwrap(await publish(s));
    expect(pub.earlyReason).toBeNull();
    expect(JSON.parse(auditEntry(s.f.deps, 'finance.annualAccounts.publish').params!)).toMatchObject({ early: false, earlyKind: null });
  });

  it('wartet mit „MV genehmigt die Jahresrechnung“ auf den Beschluss', async () => {
    const s = await signed();
    approves(s);
    expect(err(await publish(s, { earlyReason: 'itzDeadline' }))).toMatchObject({ code: 'annualAccountsAssemblyPending' });
    await assembly(s, { accountsApproved: 'notVoted' });
    expect(err(await publish(s))).toMatchObject({ code: 'annualAccountsAssemblyPending' });
    await assembly(s, { accountsApproved: 'yes' });
    unwrap(await publish(s));
  });

  it('verlangt beide Rechte, nur einen Menschen und das Webseiten-Modul', async () => {
    const s = await signed();
    expect(err(await publishAnnualAccounts(s.f.deps, s.f.ctx, { reportId: s.report.id, earlyReason: 'itzDeadline' }))).toMatchObject({ type: 'forbidden' });
    expect(err(await publishAnnualAccounts(s.f.deps, ctxWith(['site.publish', 'finance.read'], s.f.userId), { reportId: s.report.id, earlyReason: 'itzDeadline' }))).toMatchObject({ type: 'forbidden' });
    expect(err(await publishAnnualAccounts(s.f.deps, { ...s.publisher, channel: 'mcp' }, { reportId: s.report.id, earlyReason: 'itzDeadline' }))).toMatchObject({ code: 'humanOnly' });
    unwrap(await setModuleEnabled(s.f.deps, ctxWith(['modules.manage']), { key: 'site', enabled: false }));
    expect(err(await publish(s, { earlyReason: 'itzDeadline' }))).toMatchObject({ code: 'siteModuleDisabled' });
  });

  it('lehnt ein zweites Veröffentlichen ab; Zurücknehmen leert die Sicht', async () => {
    const s = await signed();
    unwrap(await publish(s, { earlyReason: 'itzDeadline' }));
    expect(err(await publish(s, { earlyReason: 'itzDeadline' }))).toMatchObject({ code: 'annualAccountsAlreadyPublished' });
    expect(view(s)).toHaveLength(1);
    const back = unwrap(await withdrawAnnualAccounts(s.f.deps, s.publisher, { reportId: s.report.id }));
    expect(back).toMatchObject({ withdrawnCause: 'manual' });
    expect(back.withdrawnAt).not.toBeNull();
    expect(view(s)).toEqual([]);
    expect(JSON.parse(auditEntry(s.f.deps, 'finance.annualAccounts.withdraw').params!)).toEqual({ designation: '2025', documentNumber: s.signature.documentNumber });
    expect(err(await withdrawAnnualAccounts(s.f.deps, s.publisher, { reportId: s.report.id }))).toMatchObject({ code: 'annualAccountsNotPublished' });
    expect(err(await withdrawAnnualAccounts(s.f.deps, s.f.ctx, { reportId: s.report.id }))).toMatchObject({ type: 'forbidden' });
  });

  it('veröffentlicht dieselbe Fassung nach dem Zurücknehmen wieder, nach den gewöhnlichen Regeln', async () => {
    const s = await signed();
    unwrap(await publish(s, { earlyReason: 'itzDeadline' }));
    unwrap(await withdrawAnnualAccounts(s.f.deps, s.publisher, { reportId: s.report.id }));
    expect(err(await publish(s))).toMatchObject({ code: 'annualAccountsEarlyReasonRequired' });
    const again = unwrap(await publish(s, { earlyReason: 'funderRequest' }));
    expect(again).toMatchObject({ corrected: false, earlyReason: 'funderRequest', replacesFinalizedAt: null });
  });

  it('liefert in der Sicht genau die Felder des Schemas; die Datei löst zu PDF-Bytes auf', async () => {
    const s = await signed();
    unwrap(await publish(s, { earlyReason: 'itzDeadline' }));
    const rows = view(s);
    expect(rows).toEqual([{ year: '2025', title: 'Jahresrechnung 2025', finalizedOn: '2026-09-05', pdfAssetId: `finance.annualAccounts.${s.signature.documentId}`, corrected: false, replacesFinalizedOn: null, webVersionOn: null }]);
    const text = JSON.stringify(rows);
    expect(text).not.toMatch(/Petra|Privatier|Vera|5000/);
    const file = resolvePublishedFile(s.f.deps, `finance.annualAccounts.${s.signature.documentId}`)!;
    expect(file.mimeType).toBe('application/pdf');
    expect(file.filename).toMatch(/^jahresrechnung-2025-[a-z0-9-]+\.pdf$/);
    expect(new TextDecoder().decode((await file.read()).subarray(0, 5))).toBe('%PDF-');
    // Nur, was eine laufende Veröffentlichung nennt: die festgeschriebene Fassung selbst nie.
    expect(resolvePublishedFile(s.f.deps, `finance.annualAccounts.${s.report.documentId}`)).toBeNull();
    unwrap(await withdrawAnnualAccounts(s.f.deps, s.publisher, { reportId: s.report.id }));
    expect(resolvePublishedFile(s.f.deps, `finance.annualAccounts.${s.signature.documentId}`)).toBeNull();
  });

  it('nennt „publiziert seit“ aus der Webseite', async () => {
    const s = await signed();
    const pub = unwrap(await publish(s, { earlyReason: 'itzDeadline' }));
    expect(pub.liveSince).toBeNull();
    s.live.set(`annualAccounts:/finance/reports/annualAccounts?year=${s.y2025}`, '2026-09-06T10:00:00.000Z');
    expect(unwrap(await withdrawAnnualAccounts(s.f.deps, s.publisher, { reportId: s.report.id }))).toMatchObject({ liveSince: null, withdrawnLiveSince: '2026-09-06T10:00:00.000Z' });
  });
});

describe('Rechte im Paket', () => {
  it('die Finanzrechte allein reichen nicht', () => {
    expect(FINANCE_PERMISSIONS).not.toContain('site.publish');
  });
});
