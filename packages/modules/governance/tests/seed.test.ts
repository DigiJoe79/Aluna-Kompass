import { seedStoryYear, SEED_CLOSED_YEARS } from '@kompass/core';
import { ctxWith, fakeMailTransport, insertUser, systemContext } from '@kompass/core/testing';
import { writeSettingInternal } from '@kompass/core';
import { membersModule } from '@kompass/module-members';
import { financeFiscalYears, financeModule, getAssemblyResult, getAuditSection, getClosingStatus } from '@kompass/module-finance';
import { describe, expect, it } from 'vitest';
import { listMeetings } from '../src/meetings';
import { motionViewsInternal } from '../src/motions';
import { quorumInternal } from '../src/quorum';
import { governanceMinutesVersions, governanceRegisterOccasions, governanceAgendaItems, governanceAssemblyRequests, governanceAttendance, governanceCircularResponses, governanceCirculars, governanceInvitationRuns, governanceMeetings, governanceMotions, governanceOffices, governanceOrgans, governanceResolutions, governanceRunLetters, governanceStatutes, governanceTerms } from '../src/schema';
import { seedGovernance } from '../src/seed';
import { getGovernanceOverview } from '../src/overview';
import { listStatutes } from '../src/statutes';
import { setupGovernance } from './helpers';
import { contactRoles } from '@kompass/module-contacts';
import { schema } from '@kompass/core';
import { governanceDeadlinesInternal } from '../src/deadlines/list';
import { listRegisterFilings } from '../src/register/filings';
import { governanceRegisterFilings } from '../src/schema';
import { readSetting, unwrap } from '@kompass/core';
import { financeAuditAuditors, financeReportSignatures, listReserves, listTaxPeriods, representativesInternal } from '@kompass/module-finance';
import { listFeeSchedules } from '@kompass/module-members';
import { divergingRoleRowsInternal } from '../src/role-rows';
import { statuteSuggestionInternal } from '../src/finance-sources/statute';

const ALL = ['governance.read', 'governance.manage', 'governance.record', 'contacts.view', 'contacts.manage', 'members.read', 'members.manage', 'members.fees', 'dms.view', 'dms.create', 'dms.send'];

/** Wie `seedDevelopment`: Mitglieder vor Gremien (Abhängigkeit), Mailversand bereit. */
async function seeded(now: string) {
  const { deps, userId } = setupGovernance(ALL, { now, mail: fakeMailTransport() });
  deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'dms.mail.fromAddress', 'verein@example.org'));
  const ctx = ctxWith(ALL, userId);
  await membersModule.seed!(deps, ctx);
  await seedGovernance(deps, ctx);
  return { deps, ctx };
}
const counts = (deps: Awaited<ReturnType<typeof seeded>>['deps']) =>
  [governanceOrgans, governanceOffices, governanceTerms, governanceStatutes, governanceMeetings, governanceAgendaItems, governanceMotions, governanceAssemblyRequests, governanceInvitationRuns, governanceRunLetters, governanceAttendance, governanceResolutions, governanceCirculars, governanceCircularResponses].map((table) => deps.db.select().from(table).all().length);

// Wie die Seed-Tests von Finanzen und Mitgliedern: Der Seed läuft über Finanzen und Mitglieder und braucht unter der vollen
// Last von verify:modul mehr als die Vorgabe von 5 s (2026-10-28: Zeitüberschreitung bei 4 Fällen).
describe('seedGovernance', { timeout: 30_000 }, () => {
  it('runs once: a second run adds nothing', async () => {
    const { deps, ctx } = await seeded('2026-09-05T08:00:00.000Z');
    const first = counts(deps);
    expect(first[2]).toBeGreaterThanOrEqual(6);
    const board = deps.db.select().from(governanceOrgans).all().find((o) => o.kind === 'board')!.id;
    expect(deps.db.select().from(governanceStatutes).all().every((st) => st.rules.organs[board]?.representation?.mode === 'two')).toBe(true);
    await seedGovernance(deps, ctx);
    expect(counts(deps)).toEqual(first);
  });

  it.each(['2026-09-05T08:00:00.000Z', '2027-01-02T08:00:00.000Z', '2027-03-01T08:00:00.000Z', '2027-08-30T08:00:00.000Z'])('seeds three statute stands, terms and an archived organ relative to the story year (%s)', async (now) => {
    const { deps, ctx } = await seeded(now);
    const y = seedStoryYear(now.slice(0, 10));
    const statutes = (await listStatutes(deps, ctx, {})) as { ok: true; value: { state: string; lastResolvedOn: string | null; registeredOn: string | null; taxReview: { affectsCharity: boolean | null; answer: string | null } }[] };
    expect(statutes.value.map((s) => s.state)).toEqual(['superseded', 'valid', 'resolved']);
    expect(statutes.value[0]!.registeredOn?.slice(0, 4)).toBe(String(y - SEED_CLOSED_YEARS));
    expect(statutes.value[1]!.registeredOn?.slice(0, 4)).toBe(String(y - 1));
    expect(statutes.value[2]!.lastResolvedOn?.slice(0, 4)).toBe(String(y));
    expect(statutes.value[2]).toMatchObject({ registeredOn: null, taxReview: { affectsCharity: true, answer: null } });
    const terms = deps.db.select().from(governanceTerms).all();
    expect(terms.some((t) => t.endReason === 'resigned' && t.endReceivedOn !== null)).toBe(true);
    expect(terms.some((t) => t.origin === 'backfilled' && t.roleRowIds.length > 0)).toBe(true);
    const auditor = deps.db.select().from(governanceOffices).all().find((o) => o.function === 'auditor')!;
    expect(terms.filter((t) => t.officeId === auditor.id && t.until === null)).toHaveLength(2);
    expect(deps.db.select().from(governanceOrgans).all().some((o) => o.kind === 'other' && !o.active)).toBe(true);
    const today = now.slice(0, 10);
    expect([...terms.map((t) => t.since), ...terms.flatMap((t) => (t.until ? [t.until] : []))].filter((d) => d > today)).toEqual([]);
  });

  it('the representing offices of the start data make chair, deputy and treasurer representatives on the day (G7, V-2)', async () => {
    const { deps } = await seeded('2026-09-05T08:00:00.000Z');
    const names = representativesInternal(deps.db, '2026-09-05').map((r) => r.name);
    expect(names.sort()).toEqual(['Clara Neumann', 'Lena Brückner', 'Thomas Wendt']);
  });

  it('G7: a sealed ordinary assembly of the story year discharges the board of the previous year — step 11 is managed and done; a second run adds nothing', async () => {
    const now = '2026-09-05T08:00:00.000Z';
    const { deps, userId } = setupGovernance(ALL, { now, mail: fakeMailTransport() });
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'dms.mail.fromAddress', 'verein@example.org'));
    const ctx = ctxWith([...deps.registry.permissionKeys], userId);
    await financeModule.seed!(deps, ctx);
    await membersModule.seed!(deps, ctx);
    await seedGovernance(deps, ctx);
    const y = seedStoryYear(now.slice(0, 10));
    const previous = deps.db.select().from(financeFiscalYears).all().find((f) => f.designation === String(y - 1))!;
    const res = unwrap(await getAssemblyResult(deps, ctx, { fiscalYearId: previous.id }));
    expect(res.result).toMatchObject({ assemblyOn: `${y}-03-14`, accountsApproved: 'yes', complete: true, managed: { module: 'governance' } });
    const status = unwrap(await getClosingStatus(deps, ctx, { fiscalYearId: previous.id }));
    expect(status.steps.find((s) => s.key === 'assembly')!.done).toBe(true);
    // G-30: Abschnitt 9 der Kassenprüfung des Vorjahrs (Miras Prüfjahr) hat Zeilen — Kassenbericht, Entlastung, Beitragsordnung.
    const section = unwrap(await getAuditSection(deps, ctx, { fiscalYearId: previous.id, section: 'resolutions', limit: 200 }));
    expect(new Set(section.rows.map((r) => r.labelParams.resolutionKind))).toEqual(new Set(['accounts', 'discharge', 'feeSchedule']));
    const first = counts(deps);
    await seedGovernance(deps, ctx);
    expect(counts(deps)).toEqual(first);
  }, 60_000);

  it('V-2: finance and Gremien tell one story — board, treasurer, auditors, assemblies, statute date, signers; one sealed resolution each for remuneration, reserve and fee schedule, linked; the valid stand has its text', async () => {
    const now = '2026-09-05T08:00:00.000Z';
    const { deps, userId } = setupGovernance(ALL, { now, mail: fakeMailTransport() });
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'dms.mail.fromAddress', 'verein@example.org'));
    const ctx = ctxWith([...deps.registry.permissionKeys], userId);
    // Wie der Kernseed: Mira Klein prüft in Kompass (Finanzen legen ihren Kontakt an).
    insertUser(deps, { name: 'Mira Klein', email: 'mira@kompass.local' });
    await financeModule.seed!(deps, ctx);
    await membersModule.seed!(deps, ctx);
    await seedGovernance(deps, ctx);
    const today = now.slice(0, 10);
    const y = seedStoryYear(today);
    // Jede Rollenzeile von Vorstand, Kasse und Kassenprüfung trägt eine Amtszeit — keine zweite Geschichte am Kontakt.
    expect(divergingRoleRowsInternal(deps.db, today)).toBe(0);
    expect(deps.db.select().from(contactRoles).all().filter((r) => ['board-member', 'treasurer', 'auditor'].includes(r.role) && !deps.db.select().from(governanceTerms).all().some((t) => t.roleRowIds.includes(r.id)))).toEqual([]);
    // Wer die Jahresrechnung abzeichnet, vertritt den Verein an dem Tag laut Gremien.
    const signatures = deps.db.select().from(financeReportSignatures).all();
    expect(signatures.length).toBeGreaterThan(0);
    for (const s of signatures) expect(representativesInternal(deps.db, s.signedOn).map((r) => r.contactId)).toContain(s.contactId);
    // Die Kassenprüfer des Vorjahres sind die in Gremien gewählten, mit dem Tag der Wahl.
    const previous = deps.db.select().from(financeFiscalYears).all().find((f) => f.designation === String(y - 1))!;
    const auditorOffice = deps.db.select().from(governanceOffices).all().find((o) => o.function === 'auditor')!;
    const auditorTerms = deps.db.select().from(governanceTerms).all().filter((t) => t.officeId === auditorOffice.id && t.since <= previous.endsOn && (t.until === null || t.until >= previous.startsOn));
    const listed = deps.db.select().from(financeAuditAuditors).all().filter((a) => a.fiscalYearId === previous.id);
    expect(listed.map((a) => a.contactId).sort()).toEqual(auditorTerms.map((t) => t.contactId).sort());
    for (const a of listed) expect(a.electedOn).toBe(auditorTerms.find((t) => t.contactId === a.contactId)!.since);
    // Die Anlage Gem trägt das Satzungsdatum, das Gremien zum Ende des Zeitraums vorschlägt.
    for (const period of unwrap(await listTaxPeriods(deps, ctx, {})).filter((p) => p.answers.statuteDate)) {
      const last = deps.db.select().from(financeFiscalYears).all().find((f) => f.id === period.lastFiscalYearId)!;
      expect(period.answers.statuteDate).toBe(statuteSuggestionInternal(deps, deps.db, last.endsOn)?.statuteDate);
    }
    // Beschlüsse zu Vergütung, Rücklage und Beitragsordnung, festgeschrieben und angenommen; die beiden Verweise zeigen auf sie.
    const sealedOf = (kind: string) => deps.db.select().from(governanceResolutions).all().filter((r) => r.kind === kind && r.outcome === 'adopted' && r.number !== null);
    for (const kind of ['remuneration', 'reserve', 'feeSchedule']) expect(sealedOf(kind), kind).toHaveLength(1);
    // K-8: Die Pauschale hat ihre Grundlage im gültigen Stand.
    const { resolutionViewInternal } = await import('../src/resolutions');
    expect(resolutionViewInternal(deps.db, deps, sealedOf('remuneration')[0]!).warnings).not.toContain('remunerationWithoutStatute');
    expect(unwrap(await listReserves(deps, ctx, {})).some((r) => r.resolutionId === sealedOf('reserve')[0]!.id)).toBe(true);
    const schedules = unwrap(await listFeeSchedules(deps, ctx, {}));
    expect(schedules.find((s) => s.resolutionId === sealedOf('feeSchedule')[0]!.id)).toMatchObject({ warnings: [] });
    // Der gültige Stand hat seinen Wortlaut.
    expect(statuteSuggestionInternal(deps, deps.db, today)?.documentId).not.toBeNull();
    // Gremien aus: Das Ergebnis der Finanzen von Hand nennt dieselben Versammlungen wie Gremien.
    const assemblies = deps.db.select().from(governanceMeetings).all().filter((m) => m.sealedAt && (m.kind === 'ordinary' || m.kind === 'repeat' || m.kind === 'extraordinary'));
    const byYear = new Map<string, string>();
    for (const r of deps.db.select().from(governanceResolutions).all().filter((r) => r.kind === 'accounts' && r.outcome === 'adopted')) {
      const fy = (r.details as { fiscalYearId?: string } | null)?.fiscalYearId;
      const meeting = assemblies.find((m) => m.id === r.meetingId);
      if (fy && meeting) byYear.set(fy, meeting.heldOn);
    }
    expect(byYear.size).toBeGreaterThanOrEqual(2);
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'modules.enabled', ['contacts', 'dms', 'projects', 'finance', 'members']));
    for (const [fiscalYearId, heldOn] of byYear) expect(unwrap(await getAssemblyResult(deps, ctx, { fiscalYearId })).result?.assemblyOn, fiscalYearId).toBe(heldOn);
  }, 90_000);

  it('Block G2: meetings in the states invited, planned and cancelled, a late motion, a reached request, a run with five letters', async () => {
    const { deps, ctx } = await seeded('2027-03-01T08:00:00.000Z');
    const meetings = (await listMeetings(deps, ctx, {})) as { ok: true; value: { state: string; kind: string }[] };
    const states = new Set(meetings.value.map((m) => m.state));
    for (const s of ['invited', 'planned', 'cancelled']) expect(states, s).toContain(s);
    const late = deps.db.select().from(governanceMeetings).all().flatMap((m) => motionViewsInternal(deps.db, m)).filter((m) => m.late);
    expect(late).toHaveLength(1);
    const run = deps.db.select().from(governanceInvitationRuns).get()!;
    expect(run.status).toBe('running');
    expect(deps.db.select().from(governanceRunLetters).all()).toHaveLength(5);
    expect(deps.db.select().from(governanceAssemblyRequests).all()).toHaveLength(1);
  });

  it.each(['2026-09-05T08:00:00.000Z', '2027-03-01T08:00:00.000Z'])('Block G3: a running board meeting, recorded assemblies, an inquorate one with its repeat, two circulars (%s)', async (now) => {
    const { deps, ctx } = await seeded(now);
    const meetings = (await listMeetings(deps, ctx, {})) as { ok: true; value: { id: string; state: string; kind: string; repeatOfId: string | null }[] };
    const states = meetings.value.map((m) => m.state);
    expect(states.filter((s) => s === 'running')).toHaveLength(1);
    // Beendet, nicht festgeschrieben: die Vorstandssitzung im Juni (die Versammlungen des Vorjahres schreibt G4 fest).
    expect(states.filter((s) => s === 'recorded').length).toBeGreaterThanOrEqual(1);
    const repeat = meetings.value.find((m) => m.kind === 'repeat')!;
    expect(quorumInternal(deps.db, deps, repeat.repeatOfId!, '19:30').met).toBe(false);
    expect(quorumInternal(deps.db, deps, repeat.id, '19:30')).toMatchObject({ required: null, basis: 'none' });
    const resolutions = deps.db.select().from(governanceResolutions).all();
    expect(resolutions.some((r) => r.kind === 'statute' && r.outcome === 'adopted')).toBe(true);
    expect(resolutions.some((r) => r.outcome === null)).toBe(true);
    // Block G4 ergänzt einen Umlauf mit Auftrag; die beiden einfachen sind die aus G3.
    expect(deps.db.select().from(governanceCirculars).all().filter((c) => c.kind === 'simple').map((c) => c.outcome).sort()).toEqual(['adopted', 'rejected']);
  });

  it.each(['2026-09-05T08:00:00.000Z', '2027-08-30T08:00:00.000Z'])('Block G4: founding backfilled and sealed, assemblies and circulars sealed without doubled terms, numbers without gaps, the founding mandate done (%s)', async (now) => {
    const { deps, ctx } = await seeded(now);
    const today = now.slice(0, 10);
    const y = seedStoryYear(today);
    const tables = [governanceTerms, contactRoles, governanceResolutions, governanceMinutesVersions, governanceRegisterOccasions, schema.followUps] as const;
    const before = tables.map((t) => deps.db.select().from(t).all().length);
    await seedGovernance(deps, ctx);
    expect(tables.map((t) => deps.db.select().from(t).all().length)).toEqual(before);

    const meetings = deps.db.select().from(governanceMeetings).all();
    const founding = meetings.find((m) => m.kind === 'founding')!;
    expect(founding).toMatchObject({ backfilled: true, heldOn: `${y - SEED_CLOSED_YEARS}-02-10` });
    expect(founding.sealedAt).not.toBeNull();
    expect(meetings.filter((m) => m.sealedAt).length).toBeGreaterThanOrEqual(3);
    // Notizen je TOP (Spec § 5.4) in festgeschriebenen Versammlungen.
    const sealedIds = new Set(meetings.filter((m) => m.sealedAt && m.organId === founding.organId).map((m) => m.id));
    expect(deps.db.select().from(governanceAgendaItems).all().filter((i) => sealedIds.has(i.meetingId) && i.minutesNote).length).toBeGreaterThanOrEqual(2);
    const unsigned = governanceDeadlinesInternal(deps, today).filter((d) => d.kind === 'minutesUnsigned');
    expect(unsigned.length).toBeGreaterThanOrEqual(1);
    // Abgleich (Review Focus 1): je Kontakt und Amt höchstens eine laufende Inhaberschaft, je Rolle eine offene Zeile.
    const terms = deps.db.select().from(governanceTerms).all();
    const running = terms.filter((t) => t.until === null).map((t) => `${t.officeId}:${t.contactId}`);
    expect(new Set(running).size).toBe(running.length);
    expect(terms.filter((t) => t.origin === 'elected').length).toBeGreaterThanOrEqual(2);
    const openRoles = deps.db.select().from(contactRoles).all().filter((r) => r.until === null).map((r) => `${r.contactId}:${r.role}`);
    expect(new Set(openRoles).size).toBe(openRoles.length);
    const statutes = deps.db.select().from(governanceStatutes).all();
    expect(statutes.flatMap((st) => st.resolutions).filter((r) => r.resolutionId !== null).length).toBeGreaterThanOrEqual(2);
    // Nummern je Jahr lückenlos ab 01.
    const numbers = deps.db.select().from(governanceResolutions).all().flatMap((r) => (r.number ? [r.number] : []));
    const byYear = new Map<string, number[]>();
    for (const n of numbers) {
      const [, year, seq] = /^B-(\d{4})-(\d{3,})$/.exec(n) ?? [];
      expect(year, n).toBeDefined();
      byYear.set(year!, [...(byYear.get(year!) ?? []), Number(seq)]);
    }
    for (const list of byYear.values()) expect(list.sort((a, b) => a - b)).toEqual(list.map((_, i) => i + 1));
    const mandates = governanceDeadlinesInternal(deps, today).filter((d) => d.kind === 'mandate');
    // Der Auftrag der Gründung ist erledigt; offen bleibt der aus dem Umlauf (Wiedervorlage in 60 Tagen).
    expect(mandates.map((m) => m.overdue)).toEqual([false]);
    expect(deps.db.select().from(governanceRegisterOccasions).all().some((o) => o.kind === 'initial')).toBe(true);
  });

  it.each(['2026-09-05T08:00:00.000Z', '2027-03-01T08:00:00.000Z'])('Block G5: first registration with an interim order and the amendment registered; the treasurer change due, not filed promptly (%s)', async (now) => {
    const { deps, ctx } = await seeded(now);
    const y = seedStoryYear(now.slice(0, 10));
    const founded = y - SEED_CLOSED_YEARS;
    const before = [governanceRegisterFilings, governanceRegisterOccasions, schema.followUps].map((t) => deps.db.select().from(t).all().length);
    await seedGovernance(deps, ctx);
    expect([governanceRegisterFilings, governanceRegisterOccasions, schema.followUps].map((t) => deps.db.select().from(t).all().length)).toEqual(before);

    const filings = { value: unwrap(await listRegisterFilings(deps, ctx, {})) };
    expect(filings.value.map((f) => [f.state, f.registeredOn, f.occasions.map((o) => o.kind).join(',')])).toEqual([
      ['registered', `${founded}-04-20`, 'initial'],
      ['registered', `${y - 1}-06-01`, 'statute'],
      ['due', null, 'boardChange,boardChange'],
    ]);
    expect(filings.value[0]!.interimOrders).toEqual([expect.objectContaining({ resolvedOn: `${founded}-04-20` })]);
    // Nicht eingereicht: Frage 1 ist berechnet, die Prüffragen zählen aber erst ab der Einreichung (0.5.0 Nr. 6).
    expect(filings.value[2]!.transparency).toMatchObject({ result: 'reportNeeded', due: false, answers: { notFiledPromptly: true } });
    expect(readSetting(deps, 'organization.registeredOn')).toBe(`${founded}-04-20`);
    const kinds = governanceDeadlinesInternal(deps, now.slice(0, 10)).map((d) => d.kind);
    expect(kinds).toContain('registerDue');
    expect(kinds).not.toContain('transparencyReport');
  });
});

/** Finanzen, Mitglieder und Gremien wie `seedDevelopment` — je Tag einmal gesät, für die Prüfungen der Glättung. */
const fullSeeds = new Map<string, ReturnType<typeof fullSeed>>();
async function fullSeed(now: string) {
  const { deps, userId } = setupGovernance(ALL, { now, mail: fakeMailTransport() });
  deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'dms.mail.fromAddress', 'verein@example.org'));
  const ctx = ctxWith([...deps.registry.permissionKeys], userId);
  await financeModule.seed!(deps, ctx);
  await membersModule.seed!(deps, ctx);
  await seedGovernance(deps, ctx);
  return { deps, ctx };
}
const fullSeeded = (now: string) => {
  if (!fullSeeds.has(now)) fullSeeds.set(now, fullSeed(now));
  return fullSeeds.get(now)!;
};

describe('seedGovernance tells a plausible story on the start page and in the overview (Bilder 0.5.0)', { timeout: 90_000 }, () => {
  it.each(['2026-09-05T08:00:00.000Z', '2027-08-30T08:00:00.000Z'])('nothing from the closed years is open: no deadline and no mandate follow-up due before the story year (%s)', async (now) => {
    const { deps } = await fullSeeded(now);
    const today = now.slice(0, 10);
    const y = seedStoryYear(today);
    const old = governanceDeadlinesInternal(deps, today).filter((d) => d.dueOn !== null && d.dueOn < `${y}-01-01`);
    expect(old.map((d) => `${d.kind} ${d.dueOn}`)).toEqual([]);
    const openFollowUps = deps.db.select().from(schema.followUps).all().filter((f) => f.doneAt === null && f.dueAt < `${y}-01-01`);
    expect(openFollowUps.map((f) => `${f.title} ${f.dueAt}`)).toEqual([]);
  });

  it('the finance setting matches the sealed approval of the annual accounts — no accountsApprovalMismatch', async () => {
    const { deps, ctx } = await fullSeeded('2026-09-05T08:00:00.000Z');
    expect(unwrap(await getGovernanceOverview(deps, ctx, {})).accountsApprovalMismatch).toBeNull();
  });

  it('the running board meeting began on its day, with chair, minute taker and findings set', async () => {
    const { deps } = await fullSeeded('2026-09-05T08:00:00.000Z');
    const running = deps.db.select().from(governanceMeetings).all().filter((m) => m.startedOn !== null && m.endedAt === null);
    expect(running).toHaveLength(1);
    const meeting = running[0]!;
    expect(meeting.startedOn).toBe(meeting.heldOn);
    expect(meeting.findings).toMatchObject({ invitationProper: true, quorate: true, chairContactId: expect.any(String), minuteTakerContactId: expect.any(String) });
    // Die Feststellungen folgen dem Vorschlag: rechtzeitig eingeladen, beschlussfähig — kein Hinweis „weicht ab“.
    const { invitationComplianceInternal } = await import('../src/invitation/compliance');
    expect(invitationComplianceInternal(deps.db, deps, meeting.id).ok).toBe(true);
    expect(quorumInternal(deps.db, deps, meeting.id, meeting.startsAt).met).toBe(true);
    // Kein Mitlauf des Seeds beginnt an einem anderen Tag als dem Sitzungstag (G-25).
    expect(deps.db.select().from(governanceMeetings).all().filter((m) => m.startedOn && m.startedOn !== m.heldOn).map((m) => m.heldOn)).toEqual([]);
  });
});
