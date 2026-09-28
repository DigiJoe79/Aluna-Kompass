import { documentBaseGaps, getEffectivePermissions, isoNow, listUserNamesWithPermission, ok, readSetting, requireAnyPermission, requirePermission, schema, todayIn, validate, writeSettingInternal, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { contactIdForUserInternal } from '@kompass/module-contacts';
import { getDocumentRecord } from '@kompass/module-dms';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict } from '../errors';
import { FINANCE_PERMISSIONS } from '../permissions';
import { financeAccounts, financeFiscalYears, financeNotices, financeSigners } from '../schema';
import { boardMembersMaintainedInternal } from './board';
import { machineStatusOf } from './machine-status';
import { noticeValidAt } from './notice-validity';

export type SetupStepKey = 'fiscalYear' | 'account' | 'roles' | 'categories' | 'tax' | 'importFormat' | 'notice' | 'machineProcedure' | 'waiverBasis' | 'boardRemuneration' | 'boardMembers' | 'documentBases';

export interface SetupStep {
  key: SetupStepKey;
  /** F4 Task 6: `importFormat` ist der erste optionale Schritt — `complete` zählt nur Pflichtschritte. */
  required: boolean;
  done: boolean;
  dependsOn: SetupStepKey | null;
  /** Die Abhängigkeit ist offen — der Schritt lässt sich noch nicht sinnvoll erledigen. */
  blocked: boolean;
  detail: Record<string, string | number>;
  permission: string;
  /** Namen aktiver Nutzer, die den Schritt erledigen können (ohne E-Mail). */
  canDo: string[];
}

/**
 * Die fünf Rollenvorschläge des Moduls (`install.ts`, `ROLES`) — hier nur
 * `originKey` und der ausgelieferte Name als Rückfalltext, falls die Rolle
 * fehlt (etwa auf einer Installation ohne `installFinance`-Lauf). Bewusst
 * dupliziert statt aus `install.ts` importiert: `install.ts` bringt die
 * Startplan-Kategorien mit, die dieser Dienst nicht braucht, und eine eigene,
 * kleine Liste hält den Einrichtungsstand unabhängig vom Startplan.
 */
const FINANCE_ROLE_ORIGINS: readonly { originKey: string; name: string }[] = [
  { originKey: 'finance:treasurer', name: 'Schatzmeister' },
  { originKey: 'finance:approver', name: 'Freigeber Finanzen' },
  { originKey: 'finance:clerk', name: 'Auslagen einreichen' },
  { originKey: 'finance:auditor', name: 'Kassenprüfer' },
  { originKey: 'finance:agent', name: 'Finanz-Agent' },
];

/**
 * Die Finanz-Navigationseinträge des Moduls (`manifest.ts`: `navigation` und
 * `adminNavigation`) — nur Schlüssel und Recht, für `getPermissionMatrix`.
 * Muss mit `manifest.ts` übereinstimmen; `tests/setup.test.ts` prüft das
 * gegen das echte Manifest, damit ein Auseinanderlaufen auffällt.
 */
const FINANCE_NAV_ENTRIES: readonly { key: string; permission: string }[] = [
  { key: 'finance.work', permission: 'finance.read' },
  { key: 'finance.workForeign', permission: 'finance.read' },
  { key: 'finance.workVouchers', permission: 'finance.read' },
  { key: 'finance.rules', permission: 'finance.read' },
  { key: 'finance.imports', permission: 'finance.read' },
  { key: 'finance.entries', permission: 'finance.read' },
  { key: 'finance.accounts', permission: 'finance.read' },
  { key: 'finance.openItems', permission: 'finance.read' },
  { key: 'finance.cash', permission: 'finance.read' },
  { key: 'finance.donations', permission: 'finance.read' },
  { key: 'finance.donationRun', permission: 'finance.read' },
  { key: 'finance.donationBook', permission: 'finance.read' },
  { key: 'finance.donationNotices', permission: 'finance.read' },
  // F8a Task 4.
  { key: 'finance.expenses', permission: 'finance.expensesSubmit' },
  { key: 'finance.approvals', permission: 'finance.approve' },
  // F7 Task 5 (Sektion „Partner und Zweckmittel“).
  { key: 'finance.partners', permission: 'finance.read' },
  // F8b Task 5 (Annahme 13): `finance.purposes` ist mit `finance.overview` allein schon sichtbar (E3 reduziert).
  { key: 'finance.purposes', permission: 'finance.overview' },
  { key: 'finance.reserves', permission: 'finance.read' },
  { key: 'finance.people', permission: 'finance.read' },
  { key: 'finance.admin', permission: 'finance.setup' },
];

function hasAnyFiscalYear(db: DbOrTx): boolean {
  return !!db.select({ id: financeFiscalYears.id }).from(financeFiscalYears).limit(1).get();
}

function accountStepDetail(db: DbOrTx): { accounts: number; withoutOpening: number } {
  const rows = db.select({ openingBalanceCents: financeAccounts.openingBalanceCents }).from(financeAccounts).where(eq(financeAccounts.isActive, true)).all();
  return { accounts: rows.length, withoutOpening: rows.filter((r) => r.openingBalanceCents === null).length };
}

/**
 * F4 Task 6 — der erste **optionale** Schritt: fertig, wenn jedes aktive
 * Bankkonto ein Auszugsformat trägt (ohne aktives Bankkonto vakuos erfüllt —
 * nichts, was ein Format bräuchte). „Optional bis zum ersten Auszug“: Ein
 * Verein kann Finanzen ohne CAMT-Import führen.
 */
function accountsWithoutImportFormat(db: DbOrTx): number {
  // F4b: auch Zahlungsdienst-Konten brauchen ein Format — sie liefern meist CSV.
  const rows = db.select({ kind: financeAccounts.kind, importFormat: financeAccounts.importFormat }).from(financeAccounts).where(eq(financeAccounts.isActive, true)).all();
  return rows.filter((r) => (r.kind === 'bank' || r.kind === 'paymentService') && r.importFormat === null).length;
}

/** Aktive Nutzer, die irgendein Finanzrecht tragen — geschützte Rollen eingeschlossen (Vorarbeiten-Spec VP4). */
function activeFinanceUsers(deps: Deps): { id: string; name: string }[] {
  const activeUsers = deps.db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(eq(schema.users.isActive, true)).all();
  return activeUsers.filter((u) => {
    const held = getEffectivePermissions(deps.db, deps.registry, u.id);
    return [...held].some((key) => key.startsWith('finance.'));
  });
}

function rolesStepDetail(deps: Deps): { done: boolean; detail: Record<string, string | number> } {
  const db = deps.db;
  const rolesWithoutUser: string[] = [];
  for (const origin of FINANCE_ROLE_ORIGINS) {
    const roleRow = db.select({ id: schema.roles.id, name: schema.roles.name }).from(schema.roles).where(eq(schema.roles.originKey, origin.originKey)).get();
    const hasActiveHolder = roleRow
      ? !!db
          .select({ id: schema.userRoles.userId })
          .from(schema.userRoles)
          .innerJoin(schema.users, eq(schema.users.id, schema.userRoles.userId))
          .where(and(eq(schema.userRoles.roleId, roleRow.id), eq(schema.users.isActive, true)))
          .limit(1)
          .get()
      : false;
    if (!hasActiveHolder) rolesWithoutUser.push(roleRow?.name ?? origin.name);
  }
  const usersWithoutContact = activeFinanceUsers(deps).filter((u) => !contactIdForUserInternal(db, u.id)).length;
  const detail: Record<string, string | number> = {};
  if (rolesWithoutUser.length > 0) detail.rolesWithoutUser = rolesWithoutUser.join(', ');
  if (usersWithoutContact > 0) detail.usersWithoutContact = usersWithoutContact;
  return { done: rolesWithoutUser.length === 0 && usersWithoutContact === 0, detail };
}

/**
 * Der Einrichtungsstand — komplett berechnet, nie gespeichert (Spec 10.5). Nur
 * `categories` und `tax` sind Bestätigungen; ihr Zeitpunkt steht in den
 * Einstellungen `finance.setupCategoriesConfirmedAt` / `…TaxConfirmedAt`.
 */
export async function getSetupStatus(deps: Deps, ctx: CallContext): Promise<Result<{ steps: SetupStep[]; complete: boolean }>> {
  const denied = requireAnyPermission(ctx, ['finance.setup', 'finance.read']);
  if (denied) return denied;

  const fiscalYearDone = hasAnyFiscalYear(deps.db);
  const account = accountStepDetail(deps.db);
  const missingImportFormats = accountsWithoutImportFormat(deps.db);
  const accountDone = account.accounts - account.withoutOpening > 0;
  const roles = rolesStepDetail(deps);
  const categoriesConfirmedAt = readSetting<string | null>(deps, 'finance.setupCategoriesConfirmedAt');
  const taxConfirmedAt = readSetting<string | null>(deps, 'finance.setupTaxConfirmedAt');
  // F6a: optional — ohne Bescheid keine Bestätigungen, aber Finanzen lässt sich ohne führen.
  // Die Reihe liest der Schritt direkt: `ledger/` kennt `donations/` nicht (Richtung, Spec 4.1).
  const notice = noticeValidAt(deps.db.select().from(financeNotices).all(), todayIn(deps));
  // F6a Task 4: optional, nach dem Bescheid — sonst Unterschriftsfeld statt Faksimile. `missing` als Liste mit Komma (detail trägt nur Text und Zahlen).
  const machine = machineStatusOf(deps.db.select().from(financeSigners).all(), todayIn(deps));

  const steps: SetupStep[] = [
    { key: 'fiscalYear', required: true, done: fiscalYearDone, dependsOn: null, blocked: false, detail: {}, permission: 'finance.setup', canDo: listUserNamesWithPermission(deps, 'finance.setup') },
    {
      key: 'account',
      required: true,
      done: accountDone,
      dependsOn: 'fiscalYear',
      blocked: !fiscalYearDone,
      detail: account,
      permission: 'finance.setup',
      canDo: listUserNamesWithPermission(deps, 'finance.setup'),
    },
    { key: 'roles', required: true, done: roles.done, dependsOn: null, blocked: false, detail: roles.detail, permission: 'users.manage', canDo: listUserNamesWithPermission(deps, 'users.manage') },
    {
      key: 'categories',
      required: true,
      done: categoriesConfirmedAt !== null,
      dependsOn: null,
      blocked: false,
      detail: categoriesConfirmedAt !== null ? { confirmedAt: categoriesConfirmedAt } : {},
      permission: 'finance.setup',
      canDo: listUserNamesWithPermission(deps, 'finance.setup'),
    },
    {
      key: 'tax',
      required: true,
      done: taxConfirmedAt !== null,
      dependsOn: null,
      blocked: false,
      detail: taxConfirmedAt !== null ? { confirmedAt: taxConfirmedAt } : {},
      permission: 'finance.setup',
      canDo: listUserNamesWithPermission(deps, 'finance.setup'),
    },
    {
      key: 'importFormat',
      required: false,
      done: missingImportFormats === 0,
      dependsOn: 'account',
      blocked: !accountDone,
      detail: { missing: missingImportFormats },
      permission: 'finance.setup',
      canDo: listUserNamesWithPermission(deps, 'finance.setup'),
    },
    {
      key: 'notice',
      required: false,
      done: notice !== null,
      dependsOn: null,
      blocked: false,
      detail: notice ? { validUntil: notice.validUntil } : {},
      permission: 'finance.donationsIssue',
      canDo: listUserNamesWithPermission(deps, 'finance.donationsIssue'),
    },
    {
      key: 'machineProcedure',
      required: false,
      done: machine.missing.length === 0,
      dependsOn: 'notice',
      blocked: notice === null,
      detail: machine.missing.length > 0 ? { missing: machine.missing.join(',') } : {},
      permission: 'finance.donationsIssue',
      canDo: listUserNamesWithPermission(deps, 'finance.donationsIssue'),
    },
  ];
  // F8a Task 4: nur sichtbar, solange Aufwandsspenden eingeschaltet sind — sonst braucht es keine
  // Anspruchsgrundlage. Direkt die Einstellung gelesen, nicht `waiversEnabled` aus `allocation/`:
  // `ledger/` kennt `allocation/` nicht (Richtung, Spec 4.1).
  if (readSetting<boolean>(deps, 'finance.expenseWaiversEnabled')) {
    steps.push({
      key: 'waiverBasis',
      required: false,
      // Befund J: eine Grundlage von vor dem Datum (ohne `agreedOn`) gilt als offen.
      done: readSetting<string>(deps, 'finance.expenseWaiverBasisText').trim() !== '' && !!readSetting<string | null>(deps, 'finance.expenseWaiverBasisAgreedOn'),
      dependsOn: null,
      blocked: false,
      detail: {},
      permission: 'finance.setup',
      canDo: listUserNamesWithPermission(deps, 'finance.setup'),
    });
  }
  // F8b Annahme 10: optional — sonst Warnung bei Pauschalen an Vorstandsmitglieder (`relatedPartyPayments`).
  steps.push({
    key: 'boardRemuneration',
    required: false,
    // Befund AK: bestätigt ohne „gilt ab“ (Bestand) bleibt offen.
    done: readSetting<boolean>(deps, 'finance.boardRemunerationAllowed') && !!readSetting<string | null>(deps, 'finance.boardRemunerationValidFrom'),
    dependsOn: null,
    blocked: false,
    detail: {},
    permission: 'finance.setup',
    canDo: listUserNamesWithPermission(deps, 'finance.setup'),
  });
  // Befund T: optional — ohne Kontakt mit der Rolle „Vorstand“ bleibt die Liste der Zahlungen an Vorstandsmitglieder leer.
  // Nur die Kontaktrolle zählt (Amt ≠ Nutzerrolle), nie eine Ableitung aus Finanzrechten.
  const today = todayIn(deps);
  steps.push({
    key: 'boardMembers',
    required: false,
    done: boardMembersMaintainedInternal(deps.db, today, today),
    dependsOn: null,
    blocked: false,
    detail: {},
    permission: 'contacts.manage',
    canDo: listUserNamesWithPermission(deps, 'contacts.manage'),
  });
  // Befund 51 b: nur sichtbar, wenn die Installation überhaupt eigene Basen führt — dann fiele eine
  // Bestätigung auf der generischen Formularbasis neben Briefen im Vereinskopf auf.
  const bases = documentBaseGaps(deps);
  if (bases.hasOwnBases) {
    const missing = bases.missing.filter((gap) => gap.module === 'finance').map((gap) => gap.base);
    steps.push({
      key: 'documentBases',
      required: false,
      done: missing.length === 0,
      dependsOn: null,
      blocked: false,
      detail: missing.length > 0 ? { missing: missing.join(',') } : {},
      permission: 'settings.manage',
      canDo: listUserNamesWithPermission(deps, 'settings.manage'),
    });
  }
  // Task 6: „complete“ zählt nur Pflichtschritte — ein offener optionaler Schritt kippt die Einrichtung nicht.
  return ok({ steps, complete: steps.filter((s) => s.required).every((s) => s.done) });
}

const STEP_SETTING: Record<'categories' | 'tax', string> = {
  categories: 'finance.setupCategoriesConfirmedAt',
  tax: 'finance.setupTaxConfirmedAt',
};

const confirmSchema = z.object({ step: z.enum(['categories', 'tax']) });

/** Bestätigt einen der beiden Prüf-Schritte — kein Fachdatensatz ändert sich, nur der Zeitpunkt. */
export async function confirmSetupStep(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ step: 'categories' | 'tax'; confirmedAt: string }>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, confirmSchema, input);
  if (!parsed.ok) return parsed;
  return deps.db.transaction((tx: DbOrTx) => {
    const confirmedAt = isoNow(deps.clock);
    const written = writeSettingInternal(tx, deps, ctx, STEP_SETTING[parsed.value.step], confirmedAt, 'finance.setup.confirm');
    if (!written.ok) return written;
    financeAudit(tx, deps, ctx, {
      action: 'finance.setup.confirm',
      entity: 'financeSetup',
      id: parsed.value.step,
      after: { step: parsed.value.step, confirmedAt },
      summary: `Einrichtungsschritt ${parsed.value.step} bestätigt`,
    });
    return ok({ step: parsed.value.step, confirmedAt });
  });
}

/** Die drei Steuer-Schalter der Einrichtung (H7); `applyTaxDefaults` setzt sie auf ihre ausgelieferte Vorgabe zurück. */
const TAX_DEFAULT_KEYS = ['finance.isEntrepreneurOrHasVatId', 'finance.membershipFeesCertifiable', 'finance.expenseWaiversEnabled'] as const;

/** Setzt die Steuer-Schalter auf ihre Vorgabe und bestätigt `tax` in einem Zug. */
export async function applyTaxDefaults(deps: Deps, ctx: CallContext): Promise<Result<{ applied: string[] }>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  return deps.db.transaction((tx: DbOrTx) => {
    const applied: string[] = [];
    for (const key of TAX_DEFAULT_KEYS) {
      const def = deps.registry.settingDefinitions.get(key);
      if (!def) continue;
      const written = writeSettingInternal(tx, deps, ctx, key, def.default, 'finance.setup.applyTaxDefaults');
      if (!written.ok) return written;
      applied.push(key);
    }
    const confirmedAt = isoNow(deps.clock);
    const confirmed = writeSettingInternal(tx, deps, ctx, STEP_SETTING.tax, confirmedAt, 'finance.setup.confirm');
    if (!confirmed.ok) return confirmed;
    financeAudit(tx, deps, ctx, {
      action: 'finance.setup.applyTaxDefaults',
      entity: 'financeSetup',
      id: 'tax',
      after: { step: 'tax', confirmedAt, applied },
      summary: 'Steuer-Vorgaben übernommen und Schritt bestätigt',
    });
    return ok({ applied });
  });
}

/**
 * Die vier Schalter der Einrichtung (H7): die drei Steuer-Schalter und
 * „Darf ein Agent festschreiben?“ — bewusst über `finance.setup`, nicht über
 * `settings.manage`: Das ist der Hebel der Finanzeinrichtung, nicht der
 * allgemeinen Einstellungen. `finance.mcpHumanOnlyAllowed` bleibt zusätzlich
 * an den Kanal gebunden (`uiOnly`) — hier stets erfüllt, weil der Aufruf aus
 * der Oberfläche kommt, aber zur Sicherheit noch einmal geprüft.
 */
const FINANCE_SWITCH_KEYS = ['finance.isEntrepreneurOrHasVatId', 'finance.membershipFeesCertifiable', 'finance.expenseWaiversEnabled', 'finance.mcpHumanOnlyAllowed'] as const;

const switchSchema = z.object({ key: z.enum(FINANCE_SWITCH_KEYS), value: z.boolean() });

export async function setFinanceSwitch(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ key: string; value: boolean }>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, switchSchema, input);
  if (!parsed.ok) return parsed;
  const def = deps.registry.settingDefinitions.get(parsed.value.key);
  if (def?.uiOnly && ctx.channel === 'mcp') return financeConflict('switchUiOnly');
  return deps.db.transaction((tx: DbOrTx) => {
    const written = writeSettingInternal(tx, deps, ctx, parsed.value.key, parsed.value.value, 'finance.setup.switch');
    if (!written.ok) return written;
    financeAudit(tx, deps, ctx, { action: 'finance.setup.switch', entity: 'financeSetup', id: parsed.value.key, after: { step: parsed.value.key, confirmedAt: isoNow(deps.clock) }, summary: `Schalter ${parsed.value.key} gesetzt` });
    return ok({ key: parsed.value.key, value: parsed.value.value });
  });
}

/**
 * Die Grenzen der Einrichtung (H7 Spec/Briefing): Auszug genügt bis …,
 * Barspenden melden ab …, runder Betrag ab … `cents` heißt weiter so, auch
 * wenn `finance.proofGraceDays` (F7 Task 5, Annahme 18) eine Anzahl Tage statt
 * eines Betrags ist — beides ist eine ganze, nicht negative Zahl, dieselbe
 * Prüfung passt für beide.
 */
const FINANCE_LIMIT_KEYS = ['finance.statementSufficesBelowCents', 'finance.cashDonationAlertCents', 'finance.roundAmountFromCents', 'finance.proofGraceDays'] as const;

const limitSchema = z.object({ key: z.enum(FINANCE_LIMIT_KEYS), cents: z.number().int().min(0) });

/** Setzt eine der Grenzen (ganze, nicht negative Zahl — Cent-Betrag oder Tage) — nur diese Schlüssel. */
export async function setFinanceLimit(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ key: string; cents: number }>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, limitSchema, input);
  if (!parsed.ok) return parsed;
  return deps.db.transaction((tx: DbOrTx) => {
    const written = writeSettingInternal(tx, deps, ctx, parsed.value.key, parsed.value.cents, 'finance.setup.limit');
    if (!written.ok) return written;
    financeAudit(tx, deps, ctx, { action: 'finance.setup.limit', entity: 'financeSetup', id: parsed.value.key, after: { key: parsed.value.key, cents: parsed.value.cents }, summary: `Grenze ${parsed.value.key} gesetzt` });
    return ok({ key: parsed.value.key, cents: parsed.value.cents });
  });
}

const waiverBasisSchema = z
  .object({ text: z.string().trim().max(500), agreedOn: z.string().date().nullable().optional() })
  // Befund J: eine Grundlage ohne Datum ließe „vorab vereinbart“ ins Leere laufen — leeren geht ohne.
  .superRefine((v, c) => {
    if (v.text !== '' && !v.agreedOn) c.addIssue({ code: 'custom', path: ['agreedOn'], message: 'required' });
  });

/**
 * Die Anspruchsgrundlage des Vereins für Aufwandsspenden (F8a Annahme 9,
 * Checklisten-Schritt `waiverBasis`): „Vereinbarung vom … / Satzung § …“,
 * mit dem Tag, seit dem sie gilt (Befund J, Pflicht). Leer ist erlaubt. Ins Protokoll nur der Schlüssel, nie der Wortlaut.
 */
export async function setExpenseWaiverBasisText(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ text: string; agreedOn: string | null }>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, waiverBasisSchema, input);
  if (!parsed.ok) return parsed;
  return deps.db.transaction((tx: DbOrTx) => {
    const agreedOn = parsed.value.text === '' ? null : (parsed.value.agreedOn ?? null);
    const written = writeSettingInternal(tx, deps, ctx, 'finance.expenseWaiverBasisText', parsed.value.text, 'finance.setup.waiverBasis');
    if (!written.ok) return written;
    const writtenDate = writeSettingInternal(tx, deps, ctx, 'finance.expenseWaiverBasisAgreedOn', agreedOn, 'finance.setup.waiverBasis');
    if (!writtenDate.ok) return writtenDate;
    financeAudit(tx, deps, ctx, { action: 'finance.setup.waiverBasis', entity: 'financeSetup', id: 'finance.expenseWaiverBasisText', after: { key: 'finance.expenseWaiverBasisText', agreedOn }, summary: 'Anspruchsgrundlage für Aufwandsspenden gesetzt' });
    return ok({ text: parsed.value.text, agreedOn });
  });
}

/** N5: ohne die bedingte Pflicht — so zeigt es das Werkzeug; `validFrom` bei `allowed` prüft der Dienst. */
export const boardRemunerationBaseSchema = z.object({ allowed: z.boolean(), basisText: z.string().trim().max(500), validFrom: z.string().date().nullable().optional(), documentId: z.string().min(1).nullable().optional() });

export const boardRemunerationSchema = boardRemunerationBaseSchema
  // Befund AK: eine bestätigte Grundlage gilt ab einem Tag — sonst verschwände die Markierung auch für ältere Zahlungen.
  .superRefine((v, c) => {
    if (v.allowed && !v.validFrom) c.addIssue({ code: 'custom', path: ['validFrom'], message: 'required' });
  });

/**
 * Einrichtungspunkt „Vergütung des Vorstands“ (F8b Annahme 10, Checklisten-Schritt
 * `boardRemuneration`): Satzungsfundstelle und optional der MV-Beschluss aus
 * der Akte. Ohne bestätigten Punkt (`allowed = false`) warnt jede Pauschale an
 * ein Vorstandsmitglied in `relatedPartyPayments`. Ins Protokoll nur, *dass*
 * bestätigt wurde, nie der Wortlaut.
 */
export async function setBoardRemuneration(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ allowed: boolean; basisText: string; validFrom: string | null; documentId: string | null }>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, boardRemunerationSchema, input);
  if (!parsed.ok) return parsed;
  if (parsed.value.documentId) {
    const doc = await getDocumentRecord(deps, ctx, parsed.value.documentId);
    if (!doc.ok) return doc;
    if (doc.value.phase !== 'issued') return financeConflict('documentNotFinal');
    if (doc.value.status === 'voided') return financeConflict('documentVoided');
  }
  return deps.db.transaction((tx: DbOrTx) => {
    const documentId = parsed.value.documentId ?? null;
    const w1 = writeSettingInternal(tx, deps, ctx, 'finance.boardRemunerationAllowed', parsed.value.allowed, 'finance.setup.boardRemuneration');
    if (!w1.ok) return w1;
    const w2 = writeSettingInternal(tx, deps, ctx, 'finance.boardRemunerationBasisText', parsed.value.basisText, 'finance.setup.boardRemuneration');
    if (!w2.ok) return w2;
    const w3 = writeSettingInternal(tx, deps, ctx, 'finance.boardRemunerationDocumentId', documentId, 'finance.setup.boardRemuneration');
    if (!w3.ok) return w3;
    const validFrom = parsed.value.allowed ? (parsed.value.validFrom ?? null) : null;
    const w4 = writeSettingInternal(tx, deps, ctx, 'finance.boardRemunerationValidFrom', validFrom, 'finance.setup.boardRemuneration');
    if (!w4.ok) return w4;
    financeAudit(tx, deps, ctx, { action: 'finance.setup.boardRemuneration', entity: 'financeSetup', id: 'finance.boardRemunerationAllowed', after: { step: 'boardRemuneration', confirmedAt: isoNow(deps.clock), applied: parsed.value.allowed, validFrom }, summary: 'Einrichtungspunkt „Vergütung des Vorstands“ gesetzt' });
    return ok({ allowed: parsed.value.allowed, basisText: parsed.value.basisText, validFrom, documentId });
  });
}

export interface PermissionMatrixActivity {
  key: string;
  permission: string;
}

export interface PermissionMatrixRole {
  id: string;
  name: string;
  permissions: string[];
  navigation: string[];
  holders: string[];
}

/**
 * Die Matrix „Wer darf was“ (H8): Tätigkeiten in fester Reihenfolge, je auf
 * genau ein Recht abgebildet, dazu jede Rolle, die mindestens eines dieser
 * Rechte trägt — mit ihren sichtbaren Finanz-Navigationseinträgen und ihren
 * aktiven Trägern (Namen ohne E-Mail).
 */
export async function getPermissionMatrix(deps: Deps, ctx: CallContext): Promise<Result<{ activities: PermissionMatrixActivity[]; roles: PermissionMatrixRole[] }>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;

  const activities: PermissionMatrixActivity[] = FINANCE_PERMISSIONS.map((permission) => ({ key: permission.slice('finance.'.length), permission }));

  const allRoles = deps.db.select().from(schema.roles).orderBy(schema.roles.name).all();
  const roles: PermissionMatrixRole[] = [];
  for (const role of allRoles) {
    const grantedKeys = role.isProtected
      ? [...FINANCE_PERMISSIONS]
      : deps.db
          .select({ key: schema.rolePermissions.permissionKey })
          .from(schema.rolePermissions)
          .where(eq(schema.rolePermissions.roleId, role.id))
          .all()
          .map((r) => r.key)
          .filter((key): key is (typeof FINANCE_PERMISSIONS)[number] => (FINANCE_PERMISSIONS as readonly string[]).includes(key));
    if (grantedKeys.length === 0) continue;
    const navigation = FINANCE_NAV_ENTRIES.filter((entry) => grantedKeys.includes(entry.permission as (typeof FINANCE_PERMISSIONS)[number])).map((entry) => entry.key);
    const holders = deps.db
      .select({ name: schema.users.name })
      .from(schema.userRoles)
      .innerJoin(schema.users, eq(schema.users.id, schema.userRoles.userId))
      .where(and(eq(schema.userRoles.roleId, role.id), eq(schema.users.isActive, true)))
      .all()
      .map((r) => r.name)
      .sort((a, b) => a.localeCompare(b, 'de'));
    roles.push({ id: role.id, name: role.name, permissions: [...grantedKeys], navigation, holders });
  }
  return ok({ activities, roles });
}
