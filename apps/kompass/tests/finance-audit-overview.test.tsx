// @vitest-environment jsdom
import type { AuditorView, AuditStatus } from '@kompass/module-finance';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { auditHead, defaultAuditYearId } from '@/lib/finance/audit-overview';
import type { SectionSummary } from '@/lib/finance/audit-package';
import type { RemarkListRow } from '@/lib/finance/audit-remarks';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }), usePathname: () => '/finance/audit', useSearchParams: () => new URLSearchParams('year=y25') }));
vi.mock('@/app/(shell)/finance/audit/actions', () => ({ saveAuditorAction: vi.fn(), previewAuditorAction: vi.fn(async () => ({ status: 'idle' })), uploadConfidentialityAction: vi.fn(), endAuditorAccessAction: vi.fn(), removeAuditorAction: vi.fn(), startPackageRunAction: vi.fn() }));
vi.mock('@/app/(shell)/dms/search-action', () => ({ searchDocumentsAction: vi.fn(async () => []) }));
vi.mock('@/app/(shell)/contacts/search-action', () => ({ searchContactsAction: vi.fn(async () => ({ items: [], more: false })) }));
const { AuditHeader } = await import('@/app/(shell)/finance/audit/audit-header');
const { AuditorsSection } = await import('@/app/(shell)/finance/audit/auditors-section');
const { startPackageRunAction } = await import('@/app/(shell)/finance/audit/actions');
const { PackageTable } = await import('@/app/(shell)/finance/audit/package-table');
const { RemarksSection } = await import('@/app/(shell)/finance/audit/remarks-section');
afterEach(cleanup);
beforeEach(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});

const m = (path: string) => path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], messages) as string;
const wrap = (node: React.ReactNode) => render(<NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">{node}</NextIntlClientProvider>);

const status = (over: Partial<AuditStatus> = {}): AuditStatus => ({
  fiscalYearId: 'y25', yearStatus: 'closed', baseline: { id: 'b1', createdAt: '2026-02-02T10:00:00.000Z', kind: 'initial' }, referenceBaselineId: 'b1', changedEntryIds: [],
  sectionsReviewed: [], sectionsReviewedBefore: [], samples: { sampledEntries: 0, totalEntries: 0 }, remarksUnresolved: 0, report: null, followUpOpen: false, followUpConfirmedAt: null, workFixedSince: null, auditorsWithOpenAccess: 0, cashCount: null, cashCounts: [], cashKeepers: [], packageRun: null,
  me: { auditorId: null, canEditReport: false }, ...over,
});
const report = (state: 'draft' | 'readyToSign' | 'filed', scansFiled = 0) => ({ id: 'r1', kind: 'report' as const, origin: 'kompass' as const, state, scansExpected: 1, scansFiled, editorNames: [], lastEditedAt: null, lastPrintedAt: null });

describe('Jahr der Übersicht', () => {
  const years = [
    { id: 'y26', endsOn: '2026-12-31', status: 'open' },
    { id: 'y25', endsOn: '2025-12-31', status: 'closed' },
    { id: 'y24', endsOn: '2024-12-31', status: 'closed' },
  ];
  it('the running audit, else the newest closed year; an auditor his own years', () => {
    expect(defaultAuditYearId(years, 'y24', [])).toBe('y24');
    expect(defaultAuditYearId(years, null, [])).toBe('y25');
    expect(defaultAuditYearId([{ id: 'y26', endsOn: '2026-12-31', status: 'open' }], null, [])).toBe('y26');
    expect(defaultAuditYearId([], null, [])).toBeNull();
    expect(defaultAuditYearId(years, 'y25', ['y26', 'y25'])).toBe('y25');
    expect(defaultAuditYearId(years, 'y24', ['y25'])).toBe('y25');
  });
});

describe('Stand im Kopf', () => {
  it('open year, no auditors, running, follow-up, done', () => {
    expect(auditHead(status({ yearStatus: 'open' }), 2, { referenceAt: null, filedAt: null })).toEqual({ kind: 'yearOpen' });
    expect(auditHead(status(), 0, { referenceAt: null, filedAt: null })).toEqual({ kind: 'noAuditors' });
    expect(auditHead(status({ sectionsReviewed: [{ section: 'journal', auditorIds: ['a'] }], remarksUnresolved: 2 }), 2, { referenceAt: null, filedAt: null })).toMatchObject({ kind: 'running', reviewed: 1, total: 8, remarksOpen: 2, report: 'missing' });
    expect(auditHead(status({ report: report('readyToSign', 1) }), 2, { referenceAt: null, filedAt: null })).toMatchObject({ report: 'partial' });
    expect(auditHead(status({ report: report('filed'), followUpOpen: true, changedEntryIds: ['e1', 'e2'] }), 2, { referenceAt: '2026-02-02', filedAt: '2026-02-20' })).toEqual({ kind: 'followUp', since: '2026-02-02', changed: 2, filedAt: '2026-02-20' });
    expect(auditHead(status({ report: report('filed') }), 2, { referenceAt: null, filedAt: '2026-02-20' })).toEqual({ kind: 'done', filedAt: '2026-02-20', confirmedAt: null });
    // Designer Runde 8, 346: nach einer bestätigten Nachprüfung nennt der Kopf sie mit.
    expect(auditHead(status({ report: report('filed'), followUpConfirmedAt: '2026-10-26T10:00:00.000Z' }), 2, { referenceAt: null, filedAt: '2026-02-20' })).toMatchObject({ kind: 'done', confirmedAt: '2026-10-26T10:00:00.000Z' });
  });

  it('says the stand without zeros; the auditor reads with whom he audits', () => {
    const head = auditHead(status({ remarksUnresolved: 0 }), 2, { referenceAt: null, filedAt: null });
    wrap(<AuditHeader designation="2025" head={head} auditorView={{ coAuditors: [{ name: 'Paula Papier', paper: true }] }} canManage={false} />);
    const description = screen.getByTestId('audit-head').textContent!;
    expect(description).toContain(m('finance.audit.head.report.missing'));
    expect(description).not.toContain('Vermerk');
    expect(screen.getByTestId('audit-with').textContent).toContain('Paula Papier');
  });
});

const auditor = (over: Partial<AuditorView> & { name: string }): AuditorView => {
  const { name, ...rest } = over;
  return {
    id: `a-${name}`, fiscalYearId: 'y25', contactId: `c-${name}`, contactName: name, mode: 'kompass', confidential: true, confidentialityDocumentId: null, electedOn: '2024-04-12', minutesDocumentId: null,
    access: { userId: `u-${name}`, userActive: true, hasRole: true, lastLoginAt: '2026-02-06T08:00:00.000Z', endedAt: null, roleMissingOrigin: false },
    independence: { boardRole: null, involvedEntryIds: [] }, hasWork: false, version: 'v', ...rest,
  };
};
const section = (auditors: AuditorView[], over: Partial<React.ComponentProps<typeof AuditorsSection>> = {}) =>
  wrap(<AuditorsSection year={{ id: 'y25', designation: '2025', closed: true }} auditors={auditors} documents={{}} canManage canManageUsers canCreateContact={false} filedAt={null} packageFiles={[]} packageRunning={false} {...over} />);

describe('Abschnitt „Prüfer“ (Board 12a, 12h)', () => {
  it('closing a dialog opened from a row menu puts the focus back on that row’s ⋯ (Plan D1d Task 6)', async () => {
    section([auditor({ name: 'Klara Prüf' }), auditor({ name: 'Paula Papier', mode: 'paper' })]);
    const trigger = screen.getByRole('button', { name: /Klara Prüf/ });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('menuitem', { name: m('finance.audit.auditors.menu.remove') }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('a missing access is a warning with the way to it — only with user management', () => {
    const noUser = auditor({ name: 'Jonas Kunz', access: { userId: null, userActive: false, hasRole: false, lastLoginAt: null, endedAt: null, roleMissingOrigin: false } });
    section([noUser]);
    const warn = screen.getByRole('status');
    expect(warn.textContent).toContain(m('finance.audit.auditors.access.noUser'));
    expect(within(warn).getByRole('link', { name: m('finance.audit.auditors.access.createUser') }).getAttribute('href')).toBe('/admin/users');
    cleanup();
    section([noUser], { canManageUsers: false });
    expect(screen.queryByRole('link', { name: m('finance.audit.auditors.access.createUser') })).toBeNull();
    expect(screen.getByRole('status').textContent).toContain(m('finance.audit.auditors.access.askAdmin'));
  });

  it('names the other auditor for involved entries and links them; a paper auditor gets the folder', () => {
    section([auditor({ name: 'Klara Prüf', independence: { boardRole: null, involvedEntryIds: ['e1', 'e2', 'e3'] } }), auditor({ name: 'Paula Papier', mode: 'paper' })], { packageFiles: ['folder'] });
    const link = screen.getByRole('link', { name: m('finance.audit.auditors.involvedLink') });
    expect(link.getAttribute('href')).toBe('/finance/entries?ids=e1,e2,e3');
    expect(link.closest('p')!.textContent).toContain('Paula Papier');
    expect(screen.getByRole('button', { name: m('finance.audit.auditors.folder') })).toBeTruthy();
  });

  it('without the folder, „Mappe erzeugen“ starts the package run; without the right to manage, no menu', async () => {
    section([auditor({ name: 'Paula Papier', mode: 'paper' })], { canManage: false });
    fireEvent.click(screen.getByRole('button', { name: m('finance.audit.auditors.folderCreate') }));
    await waitFor(() => expect(startPackageRunAction).toHaveBeenCalledWith('y25'));
    expect(screen.queryByRole('button', { name: /Paula Papier/ })).toBeNull();
    expect(screen.queryByRole('button', { name: m('finance.audit.auditors.add') })).toBeNull();
  });

  it('after the filed report: the sentence about the access and „Zugang beenden …“ in the row; ended access is quiet', () => {
    section([auditor({ name: 'Klara Prüf' }), auditor({ name: 'Ende Prüf', access: { userId: 'u', userActive: true, hasRole: false, lastLoginAt: null, endedAt: '2026-03-20T10:00:00.000Z', roleMissingOrigin: false } })], { filedAt: '2026-02-20T10:00:00.000Z' });
    expect(screen.getByTestId('auditors-filed').textContent).toContain('Klara Prüf');
    expect(screen.getByTestId('auditors-filed').textContent).not.toContain('Ende Prüf');
    expect(screen.getAllByRole('button', { name: m('finance.audit.auditors.menu.endAccess') })).toHaveLength(1);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('mit Ergebnis der MV (Board 12h, Runde 5 260): ein Satz nach dem späteren Ereignis, ohne Link; beendeter Zugang gedämpft', () => {
    section([auditor({ name: 'Klara Prüf' })], { filedAt: '2026-02-20T10:00:00.000Z', assemblyOn: '2026-03-14' });
    const filed = screen.getByTestId('auditors-filed');
    expect(filed.textContent).toContain('14.03.2026');
    expect(filed.textContent).not.toContain('20.02.2026');
    expect(within(filed).queryByRole('link')).toBeNull();
    cleanup();
    section([auditor({ name: 'Ende Prüf', access: { userId: 'u', userActive: true, hasRole: false, lastLoginAt: null, endedAt: '2026-03-20T10:00:00.000Z', roleMissingOrigin: false } })], { filedAt: '2026-02-20T10:00:00.000Z' });
    expect(screen.getByTestId('auditor-row').hasAttribute('data-muted')).toBe(true);
  });
});

describe('Prüfpaket auf der Übersicht (Designer Runde 4 Rechenschaft, 13a)', () => {
  const summary = (section: SectionSummary['section'], over: Partial<SectionSummary> = {}): SectionSummary => ({ section, counts: {}, remarksOpen: 0, reviewedBy: [], reviewedByMe: false, reviewedBefore: null, ...over });
  const table = (sections: SectionSummary[], auditorView = false) => wrap(<PackageTable yearId="y25" sections={sections} auditorView={auditorView} />);

  it('the badge stays short; who reviewed stands in the progress line, two reviewers joined', () => {
    table([summary('journal', { counts: { samples: 3 }, reviewedBy: ['Mira Klein', 'Holger Brandt'] }), summary('reconciliation')]);
    const row = screen.getByTestId('package-journal');
    const status = row.querySelector('[data-col="status"]')!;
    expect(status.textContent).not.toContain('Mira Klein');
    const progress = row.querySelector('[data-col="meta"]')!.textContent!;
    expect(progress).toContain('3 Stichproben');
    expect(progress).toContain('Mira Klein');
    expect(progress).toContain('Holger Brandt');
    expect(progress.indexOf('3 Stichproben')).toBeLessThan(progress.indexOf('Mira Klein'));
    expect(screen.getByTestId('package-reconciliation').querySelector('[data-col="status"]')!.textContent).toBe('');
  });
});

describe('Vermerke der Übersicht (Designer Runde 4 Rechenschaft, 1.2 Nr. 5)', () => {
  const row = (over: Partial<RemarkListRow>): RemarkListRow => ({ id: 'r1', kindLabel: 'Frage', text: 'Warum?', state: 'open', stateLabel: 'offen', targetLabel: 'Buchung B-1', targetHref: '/finance/entries/e1', inPageHref: null, from: 'Mira Klein', via: null, ...over });

  it('a remark on the year jumps to the history on the same page, from the row and from „Jahr 2025“', () => {
    wrap(<RemarksSection rows={[row({ id: 'r1' }), row({ id: 'r2', text: 'Kasse?', targetLabel: 'Jahr 2025', targetHref: '/finance/audit?year=y25#vermerke-jahr', inPageHref: '#vermerke-jahr' })]} yearItems={[]} canAnswer={false} canAudit={false} />);
    const [entryRow, yearRow] = screen.getAllByTestId('audit-remark-row');
    expect(within(yearRow!).getByRole('link', { name: 'Kasse?' }).getAttribute('href')).toBe('#vermerke-jahr');
    expect(within(yearRow!).getByRole('link', { name: 'Jahr 2025' }).getAttribute('href')).toBe('#vermerke-jahr');
    expect(within(entryRow!).queryByRole('link', { name: 'Buchung B-1' })).toBeNull();
  });
});

describe('Geklärter Vermerk in der Liste (Befund 23c)', () => {
  it('opens like the others and names its state in the state column, not at the text', () => {
    const row: RemarkListRow = { id: 'r1', kindLabel: 'Frage', text: 'Wofür?', state: 'resolved', stateLabel: 'geklärt', targetLabel: 'Buchung B-1', targetHref: '/finance/entries/e1', inPageHref: null, from: 'Mira Klein', via: null };
    wrap(<RemarksSection rows={[row]} yearItems={[]} canAnswer={false} canAudit={false} />);
    const tr = screen.getByTestId('audit-remark-row');
    expect(tr.hasAttribute('data-muted')).toBe(false);
    expect(within(tr).getByRole('link', { name: 'Wofür?' }).getAttribute('href')).toBe('/finance/entries/e1');
    expect(tr.querySelector('[data-col="status"]')!.textContent).toBe('geklärt');
    expect(tr.querySelector('[data-col="title"]')!.textContent).not.toContain('geklärt');
  });
});

describe('„Hier weiter“: eine Entscheidung für beide Breiten (Designer Runde 7, 273)', () => {
  it('names the first section the auditor has not reviewed; none after filing, none when all are reviewed, none for others', async () => {
    const { nextSectionOf } = await import('@/app/(shell)/finance/audit/package-table');
    const s = [{ section: 'journal' as const, reviewedByMe: true }, { section: 'vouchers' as const, reviewedByMe: false }];
    expect(nextSectionOf(s, true, false)).toBe('vouchers');
    expect(nextSectionOf(s, true, true)).toBeUndefined();
    expect(nextSectionOf(s.map((x) => ({ ...x, reviewedByMe: true })), true, false)).toBeUndefined();
    expect(nextSectionOf(s, false, false)).toBeUndefined();
  });
});
