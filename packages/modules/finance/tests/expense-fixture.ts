import { newId, schema, unwrap, writeSettingInternal, type CallContext } from '@kompass/core';
import { ctxWith, insertRole, insertUser, systemContext } from '@kompass/core/testing';
import { contactUserLinks, createContact } from '@kompass/module-contacts';
import { saveExpenseDraft, submitExpenseClaim, uploadExpenseReceipt, type ExpenseClaimView } from '../src/allocation/expenses';
import { ledgerFixture, pdfBytes } from './helpers';

/**
 * Ausgangslage der Auslagen-Tests (F8a): der Ledger aus `ledgerFixture` und
 * zwei erfundene Helferinnen mit Nutzerkonto, verknüpftem Kontakt und nur dem
 * Recht `finance.expensesSubmit` — kein `finance.read`, kein Recht der Akte.
 * Dazu eine Verwalterin mit `users.manage` über eine Rolle, damit
 * `expenseNeedsContactLink` einen Namen nennen kann.
 */
export async function expenseFixture() {
  const f = await ledgerFixture();
  const manage: CallContext = { ...systemContext(), permissions: new Set(['contacts.manage']) };

  const helper = async (first: string, last: string, email: string) => {
    const userId = insertUser(f.deps, { name: `${first} ${last}`, email });
    const contact = unwrap(await createContact(f.deps, manage, { kind: 'person', firstName: first, lastName: last }));
    f.deps.db.insert(contactUserLinks).values({ id: newId(), userId, contactId: contact.id, linkedAt: '2026-01-01T00:00:00.000Z', linkedByUserId: userId, unlinkedAt: null, unlinkedByUserId: null }).run();
    return { userId, contactId: contact.id, ctx: ctxWith(['finance.expensesSubmit'], userId) };
  };

  const hanna = await helper('Hanna', 'Helferin', 'hanna@example.org');
  const otto = await helper('Otto', 'Oftfahrer', 'otto@example.org');

  const adminRole = insertRole(f.deps, { name: 'Verwaltung' });
  f.deps.db.insert(schema.rolePermissions).values({ roleId: adminRole, permissionKey: 'users.manage' }).run();
  const adminId = insertUser(f.deps, { name: 'Vera Verwalterin', email: 'vera@example.org' });
  f.deps.db.insert(schema.userRoles).values({ userId: adminId, roleId: adminRole }).run();

  /** Ein Nutzer ohne verknüpften Kontakt — nur `finance.expensesSubmit`. */
  const unlinkedId = insertUser(f.deps, { name: 'Ulla Unverknüpft', email: 'ulla@example.org' });
  const unlinked = ctxWith(['finance.expensesSubmit'], unlinkedId);

  return { ...f, hanna, otto, unlinked, pdf: pdfBytes };
}

export type ExpenseFixture = Awaited<ReturnType<typeof expenseFixture>>;

/** Ein JPEG-Anfang — das Foto, das kein PDF ist. */
export const jpegBytes = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);

export const EXPENSE_IBAN = 'DE66999999991234567890';

/** Ein vollständiger Entwurf: ein Beleg (19,99 €, 2026-08-20) mit PDF und eine Fahrt (84 km, 2026-08-21), IBAN — bereit zum Einreichen. */
export async function expenseReadyDraft(f: ExpenseFixture, who: ExpenseFixture['hanna'] = f.hanna, o: { iban?: string | null; waiver?: boolean; recurring?: boolean } = {}): Promise<ExpenseClaimView> {
  const draft = unwrap(
    await saveExpenseDraft(f.deps, who.ctx, {
      iban: o.iban === undefined ? EXPENSE_IBAN : o.iban,
      waiver: o.waiver ?? false,
      recurring: o.recurring ?? false,
      positions: [
        { kind: 'receipt', positionDate: '2026-08-20', amountCents: 1999, purpose: 'Futter für die Pflegestelle' },
        { kind: 'trip', positionDate: '2026-08-21', tripFrom: 'Musterstadt', tripTo: 'Beispielstadt', tripReason: 'Tierarztfahrt', tripKm: 84 },
      ],
    }),
  );
  return unwrap(await uploadExpenseReceipt(f.deps, who.ctx, { claimId: draft.id, positionId: draft.positions[0]!.id, bytes: f.pdf(), fileName: 'rechnung.pdf' }));
}

/** Ein eingereichter Antrag aus `expenseReadyDraft` — 45,19 € (19,99 € + 84 km × 0,30 €). */
export async function expenseSubmitted(f: ExpenseFixture, who: ExpenseFixture['hanna'] = f.hanna, o: { iban?: string | null; waiver?: boolean; recurring?: boolean } = {}): Promise<ExpenseClaimView> {
  return unwrap(await submitExpenseClaim(f.deps, who.ctx, { id: (await expenseReadyDraft(f, who, o)).id }));
}

export const enableExpenseWaivers = (f: ExpenseFixture, on = true) => f.deps.db.transaction((tx) => writeSettingInternal(tx, f.deps, systemContext(), 'finance.expenseWaiversEnabled', on, 'test'));

/** Freigeber ohne Buchungsrechte: nur `finance.approve` und `finance.read` — die Freigabe bucht im Namen des Vorgangs. */
export const approverCtx = (f: ExpenseFixture) => ctxWith(['finance.approve', 'finance.read'], f.secondPersonId);
