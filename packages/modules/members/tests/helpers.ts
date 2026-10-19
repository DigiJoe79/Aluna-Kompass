import { coreModule, schema, unwrap, writeSettingInternal, type CallContext, type MailTransport } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser, systemContext } from '@kompass/core/testing';
import { contactsModule, createContact, setContactChannels } from '@kompass/module-contacts';
import { dmsModule } from '@kompass/module-dms';
import { bookEntry, saveDraft, categoryIdByKeyInternal, createAccount, createFirstFiscalYear, FINANCE_PERMISSIONS, financeAccounts, financeFiscalYears, financeModule, financeOpenItems, installFinance } from '@kompass/module-finance';
import { projectsModule } from '@kompass/module-projects';
import { saveFeeSchedule } from '../src/fee-schedule';
import { installMembers } from '../src/install';
import { membersModule } from '../src/manifest';
import { memberTypes } from '../src/schema';

export const MEMBERS_PERMISSIONS = ['members.read', 'members.manage', 'members.fees'] as const;

/** Mitglieder eingeschaltet samt Abhängigkeiten, Grundausstattung angelegt. `now` setzt die Uhr (Vorgabe `TEST_NOW`, 2026). */
export function setupMembers(permissions: readonly string[] = MEMBERS_PERMISSIONS, opts: { now?: string; mail?: MailTransport } = {}) {
  const deps = createTestDeps({ manifests: [coreModule, contactsModule, dmsModule, projectsModule, financeModule, membersModule], ...(opts.now ? { now: opts.now } : {}), ...(opts.mail ? { mail: opts.mail } : {}) });
  deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'modules.enabled', ['contacts', 'dms', 'projects', 'finance', 'members']));
  deps.db.transaction((tx) => installMembers(tx, deps, systemContext()));
  const userId = insertUser(deps, { name: 'Test', email: 'test@kompass.local' });
  return { deps, ctx: ctxWith(permissions, userId), userId };
}
export type MembersDeps = ReturnType<typeof setupMembers>['deps'];

/** Ein erfundener Kontakt, angelegt über den Dienst der Kontakte mit eigenem Recht. */
export async function person(deps: MembersDeps, lastName = 'Beispiel', firstName = 'Erika'): Promise<string> {
  const ctx: CallContext = { ...systemContext(), permissions: new Set(['contacts.manage']) };
  return unwrap(await createContact(deps, ctx, { kind: 'person', firstName, lastName })).id;
}

/** Ein erfundener Kontakt für Briefe (Plan M4): mit Anschrift (abschaltbar) und, wenn gewünscht, E-Mail. */
export async function addressedPerson(deps: MembersDeps, opts: { address?: boolean; email?: string; lastName?: string } = {}): Promise<string> {
  const ctx: CallContext = { ...systemContext(), permissions: new Set(['contacts.manage']) };
  const address = opts.address === false ? {} : { street: 'Lindenweg 4', postalCode: '12345', city: 'Beispielstadt' };
  const id = unwrap(await createContact(deps, ctx, { kind: 'person', salutation: 'Frau', firstName: 'Erika', lastName: opts.lastName ?? 'Beispiel', ...address })).id;
  if (opts.email) unwrap(await setContactChannels(deps, ctx, { id, channels: [{ kind: 'email', value: opts.email, isPrimary: true }] }));
  return id;
}

/** Die Einträge einer Aktion im Protokoll, `params` gelesen. */
export function auditOf(deps: MembersDeps, action: string) {
  return deps.db
    .select()
    .from(schema.auditLog)
    .all()
    .filter((e) => e.action === action)
    .map((e) => ({ ...e, params: e.params ? (JSON.parse(e.params) as Record<string, unknown>) : null }));
}

export const asMcp = (ctx: CallContext): CallContext => ({ ...ctx, channel: 'mcp' });

/**
 * Für die Beiträge (Plan M3): Mitglieder samt Startplan der Finanzen (Kategorie `membership-fees`) und ein Stand der
 * Beitragsordnung ab `validFrom` — ordentlich 12,00 € jährlich, Fördermitglied ab 10,00 € monatlich (oder jährlich).
 */
export async function setupFees(opts: { now?: string; validFrom?: string; permissions?: readonly string[]; mail?: MailTransport } = {}) {
  const env = setupMembers(opts.permissions ?? MEMBERS_PERMISSIONS, { ...(opts.now ? { now: opts.now } : {}), ...(opts.mail ? { mail: opts.mail } : {}) });
  env.deps.db.transaction((tx) => installFinance(tx, env.deps, systemContext()));
  const types = Object.fromEntries(env.deps.db.select().from(memberTypes).all().map((t) => [t.key, t.id])) as Record<'regular' | 'supporting' | 'honorary', string>;
  const ctx: CallContext = { ...env.ctx, permissions: new Set([...env.ctx.permissions, 'members.fees']) };
  const schedule = unwrap(
    await saveFeeSchedule(env.deps, ctx, {
      validFrom: opts.validFrom ?? '2027-01-01',
      rules: [
        { typeId: types.regular, amountCents: 1200, interval: 'yearly', minimum: false, allowedIntervals: ['yearly', 'halfYearly'] },
        { typeId: types.supporting, amountCents: 1000, interval: 'monthly', minimum: true, allowedIntervals: ['monthly', 'yearly'] },
      ],
    }),
  );
  return { ...env, types, schedule };
}

/**
 * Bezahlt einen offenen Posten (ganz oder teilweise) über eine festgeschriebene Buchung der Finanzen — Geschäftsjahr und
 * Bankkonto entstehen beim ersten Aufruf.
 */
/** Zahlt den Posten mit einer festgeschriebenen Buchung, mit `draft` nur als Entwurf (R6). */
export async function payOpenItem(deps: MembersDeps, openItemId: string, amountCents: number, entryDate: string, opts: { draft?: boolean } = {}): Promise<void> {
  const ctx: CallContext = { ...systemContext(), permissions: new Set(FINANCE_PERMISSIONS) };
  const year = entryDate.slice(0, 4);
  if (!deps.db.select().from(financeFiscalYears).get()) unwrap(await createFirstFiscalYear(deps, ctx, { startsOn: `${year}-01-01`, endsOn: `${year}-12-31` }));
  const bank = deps.db.select().from(financeAccounts).get() ?? unwrap(await createAccount(deps, ctx, { name: 'Vereinskonto', kind: 'bank', iban: 'DE23999999990000202051', isMain: true }));
  const categoryId = categoryIdByKeyInternal(deps.db, 'membership-fees')!;
  const lines = { entryDate, text: 'Beitrag', moneyLines: [{ accountId: bank.id, amountCents, settlements: [{ openItemId, amountCents }] }], allocationLines: [{ categoryId, amountCents }] };
  if (opts.draft) unwrap(await saveDraft(deps, ctx, lines));
  else unwrap(await bookEntry(deps, ctx, lines));
}

/**
 * Setzt den Anlagetag aller offenen Posten auf `day` — als wären die Beiträge rechtzeitig vor ihrer Fälligkeit
 * angelegt (Beitragslauf im Vorjahr) und nicht erst rückwirkend bei der Aufnahme im Test.
 */
export function enteredOn(deps: MembersDeps, day: string): void {
  deps.db.update(financeOpenItems).set({ itemDate: day }).run();
}
