import { schema as core, unwrap, writeSettingInternal } from '@kompass/core';
import { auditEntry, ctxWith, loadAllViews, systemContext } from '@kompass/core/testing';
import { createContact } from '@kompass/module-contacts';
import { documents } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { recordNameConsent } from '../src/allocation/name-consents';
import { financeModule } from '../src/manifest';
import { publishAnnualAccounts } from '../src/closing/annual-accounts-publish';
import { signAnnualAccounts } from '../src/closing/annual-accounts-sign';
import { refreshAnnualAccountsWebVersionsInternal } from '../src/closing/annual-accounts-publish';
import { financeAnnualAccountsPublications } from '../src/schema';
import { finalizedAnnualAccounts } from './annual-accounts-j2-fixture';

type Setup = Awaited<ReturnType<typeof finalizedAnnualAccounts>>;
type Row = { year: string; pdfAssetId: string; webVersionOn: string | null };
const view = (s: Setup) => loadAllViews(s.f.deps, financeModule).annualAccounts! as Row[];
const republish = (s: Setup) => s.f.deps.db.select().from(core.followUps).all().filter((r) => r.doneAt === null && r.title.startsWith('Webseite neu publizieren'));

async function published(opts: Parameters<typeof finalizedAnnualAccounts>[0] = {}) {
  const s = await finalizedAnnualAccounts(opts);
  for (const report of [s.report, s.report2024].filter((r) => r !== null)) {
    unwrap(await signAnnualAccounts(s.f.deps, s.board.ctx, { reportId: report.id }));
    unwrap(await publishAnnualAccounts(s.f.deps, s.publisher, { reportId: report.id, earlyReason: 'itzDeadline' }));
  }
  return s;
}
const revoke = (s: Setup, ctx = s.f.ctx) => recordNameConsent(s.f.deps, ctx, { kind: 'revoked', contactId: s.donor.id, on: '2026-09-05' }).then(unwrap);

describe('Widerruf der Einwilligung — Webfassung der veröffentlichten Jahresrechnung', () => {
  it('rendert eine Webfassung ohne den Namen, gleicher Kurz-Hash; festgeschriebene und abgezeichnete Fassung bleiben', async () => {
    const s = await published();
    const before = s.f.deps.db.select().from(documents).all();
    const pdfBefore = view(s)[0]!.pdfAssetId;
    expect(s.renders.at(-1)).toContain('Petra Privatier');
    await revoke(s, ctxWith(['finance.entriesWrite'], s.f.userId));
    const web = s.renders.at(-1)!;
    expect(web).toContain('für die Webseite');
    expect(web).not.toContain('Petra Privatier');
    expect(web).toContain(s.shortHash);
    const rows = view(s);
    expect(rows).toEqual([expect.objectContaining({ year: '2025', webVersionOn: '2026-09-05' })]);
    expect(rows[0]!.pdfAssetId).not.toBe(pdfBefore);
    for (const doc of before) expect(s.f.deps.db.select().from(documents).where(eq(documents.id, doc.id)).get()).toEqual(doc);
    const pub = s.f.deps.db.select().from(financeAnnualAccountsPublications).get()!;
    expect(pub).toMatchObject({ webVersionOn: '2026-09-05', withdrawnAt: null });
    expect(republish(s)).toMatchObject([{ entityType: 'financeFiscalYear', entityId: s.y2025, assigneeUserId: s.f.userId, title: 'Webseite neu publizieren (Jahresrechnung 2025)' }]);
    expect(JSON.parse(auditEntry(s.f.deps, 'finance.annualAccounts.webVersion').params!)).toEqual({ designation: '2025', documentNumber: pub.webDocumentNumber });
  });

  it('schickt der Person, die veröffentlicht hat, eine Mail, wenn eine andere widerruft', async () => {
    const s = await published();
    const other = ctxWith(['finance.entriesWrite'], s.board.userId);
    await revoke(s, other);
    expect(s.mail.sent.map((m) => m.to)).toEqual(['test@kompass.local']);
  });

  it('tut nichts für einen Kontakt, den keine veröffentlichte Jahresrechnung nennt', async () => {
    const s = await published();
    const stranger = unwrap(await createContact(s.f.deps, ctxWith(['contacts.manage']), { kind: 'person', firstName: 'Otto', lastName: 'Ohne' }));
    expect(await refreshAnnualAccountsWebVersionsInternal(s.f.deps, s.f.ctx, stranger.id)).toEqual({ refreshed: 0, failed: 0 });
    expect(republish(s)).toEqual([]);
  });

  it('nimmt die Zeile aus der Sicht, wenn die Webfassung nicht entsteht, und legt die Wiedervorlage trotzdem an', async () => {
    const s = await published();
    s.f.deps.db.transaction((tx) => writeSettingInternal(tx, s.f.deps, systemContext(), 'documents.bases', { 'finance-report': 'fehlt' }));
    s.f.deps.documents = { ...s.f.deps.documents, base: () => undefined };
    await revoke(s);
    expect(view(s)).toEqual([]);
    expect(s.f.deps.db.select().from(financeAnnualAccountsPublications).get()).toMatchObject({ withdrawnCause: 'renderFailed' });
    expect(republish(s)).toHaveLength(1);
  });

  it('erneuert beide Jahre, in denen die Person genannt ist (Review Focus 2)', async () => {
    const s = await published({ years: ['2024', '2025', '2026'] });
    expect(view(s)).toHaveLength(2);
    expect(await refreshAnnualAccountsWebVersionsInternal(s.f.deps, s.f.ctx, s.donor.id)).toEqual({ refreshed: 0, failed: 0 });
    await revoke(s);
    const rows = view(s);
    expect(rows.map((r) => [r.year, r.webVersionOn])).toEqual([['2025', '2026-09-05'], ['2024', '2026-09-05']]);
    expect(republish(s)).toHaveLength(2);
  });

  it('nimmt Namen nur heraus, nie hinzu (Abnahme J2, Punkt 3)', async () => {
    const s = await published({ secondDonor: true });
    expect(s.renders.at(-1)).not.toContain('Otto Ohne');
    unwrap(await recordNameConsent(s.f.deps, s.f.ctx, { kind: 'granted', contactId: s.secondDonor!.id, on: '2026-09-05', fromYear: 2025 }));
    await revoke(s);
    const web = s.renders.at(-1)!;
    expect(web).toContain('für die Webseite');
    expect(web).not.toContain('Petra Privatier');
    expect(web).not.toContain('Otto Ohne');
  });

  it('stellt nach einer gescheiterten Webfassung wieder eine Fassung ohne den Namen bereit', async () => {
    const s = await published();
    const original = s.f.deps.documents;
    s.f.deps.documents = { ...original, base: () => undefined };
    await revoke(s);
    expect(view(s)).toEqual([]);
    s.f.deps.documents = original;
    const pub = unwrap(await publishAnnualAccounts(s.f.deps, s.publisher, { reportId: s.report.id, earlyReason: 'itzDeadline' }));
    expect(pub.webVersionOn).toBe('2026-09-05');
    expect(s.renders.at(-1)).not.toContain('Petra Privatier');
    expect(view(s)).toEqual([expect.objectContaining({ webVersionOn: '2026-09-05' })]);
    expect(republish(s)).toEqual([]);
  });
});
