'use server';

import { guardAction } from '@/lib/action-guard';
import {
  applyTaxDefaults,
  confirmSetupStep,
  createAccount,
  createCategory,
  createFirstFiscalYear,
  createPurpose,
  dissolvePurpose,
  fulfillPurpose,
  removeDatedValue,
  reopenPurpose,
  setAccountActive,
  setBoardRemuneration,
  setCategoryActive,
  setDatedValue,
  setExpenseWaiverBasisText,
  setFinanceLimit,
  setFinanceSwitch,
  setPurposeActive,
  updateAccount,
  updateCategory,
  updateFiscalYear,
  updatePurpose,
} from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

const revalidateFinanceAdmin = () => {
  revalidatePath('/admin/finance');
  revalidatePath('/finance/accounts');
  revalidatePath('/finance/entries');
};

export async function confirmSetupStepAction(step: 'categories' | 'tax'): Promise<ActionState> {
  return guardAction('(shell)/admin/finance/actions.ts#confirmSetupStepAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await confirmSetupStep(deps, ctx, { step });
    revalidateFinanceAdmin();
    if (!result.ok) return toActionState(result, t);
    return toActionState(result, t, t('finance.admin.checklist.toast.confirmed'));
  });
}

export async function applyTaxDefaultsAction(): Promise<ActionState> {
  return guardAction('(shell)/admin/finance/actions.ts#applyTaxDefaultsAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await applyTaxDefaults(deps, ctx);
    revalidateFinanceAdmin();
    if (!result.ok) return toActionState(result, t);
    return toActionState(result, t, t('finance.admin.checklist.toast.taxDefaultsApplied'));
  });
}

export async function setFinanceSwitchAction(key: string, value: boolean): Promise<ActionState> {
  return guardAction('(shell)/admin/finance/actions.ts#setFinanceSwitchAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await setFinanceSwitch(deps, ctx, { key, value });
    revalidateFinanceAdmin();
    return toActionState(result, t);
  });
}

export async function setFinanceLimitAction(key: string, cents: number): Promise<ActionState> {
  return guardAction('(shell)/admin/finance/actions.ts#setFinanceLimitAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await setFinanceLimit(deps, ctx, { key, cents });
    revalidateFinanceAdmin();
    if (!result.ok) return toActionState(result, t);
    return toActionState(result, t, t('finance.admin.tax.limits.saved'));
  });
}

export async function setExpenseWaiverBasisAction(text: string, agreedOn: string | null): Promise<ActionState> {
  return guardAction('(shell)/admin/finance/actions.ts#setExpenseWaiverBasisAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await setExpenseWaiverBasisText(deps, ctx, { text, agreedOn });
    revalidateFinanceAdmin();
    if (!result.ok) return toActionState(result, t);
    return toActionState(result, t, t('finance.admin.tax.waiverBasis.saved'));
  });
}

/** F8b Annahme 10: Einrichtungspunkt „Vergütung des Vorstands“ — der MV-Beschluss (documentId) kommt erst mit der Personenübersicht (D4). */
export async function setBoardRemunerationAction(allowed: boolean, basisText: string, validFrom: string | null): Promise<ActionState> {
  return guardAction('(shell)/admin/finance/actions.ts#setBoardRemunerationAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await setBoardRemuneration(deps, ctx, { allowed, basisText, validFrom });
    revalidateFinanceAdmin();
    return toActionState(result, t);
  });
}

export interface AccountInput {
  id?: string;
  expectedVersion?: string;
  name: string;
  kind: 'bank' | 'cash' | 'paymentService';
  iban?: string | null;
  bic?: string | null;
  bankName?: string | null;
  openingBalanceCents?: number | null;
  openingDate?: string | null;
  isMain?: boolean;
  documentId?: string | null;
}

export async function saveAccountAction(input: AccountInput): Promise<ActionState> {
  return guardAction('(shell)/admin/finance/actions.ts#saveAccountAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const { id, expectedVersion, ...fields } = input;
    const result = id ? await updateAccount(deps, ctx, { id, expectedVersion, ...fields }) : await createAccount(deps, ctx, fields);
    revalidateFinanceAdmin();
    if (!result.ok) return toActionState(result, t);
    return toActionState(result, t, t(id ? 'finance.admin.accounts.toast.updated' : 'finance.admin.accounts.toast.created'));
  });
}

export async function setAccountActiveAction(id: string, isActive: boolean, expectedVersion: string): Promise<ActionState> {
  return guardAction('(shell)/admin/finance/actions.ts#setAccountActiveAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await setAccountActive(deps, ctx, { id, isActive, expectedVersion });
    revalidateFinanceAdmin();
    return toActionState(result, t);
  });
}

export interface CategoryInput {
  id?: string;
  expectedVersion?: string;
  key?: string;
  name: string;
  explanation?: string;
  direction: 'income' | 'expense' | 'transit';
  sphere?: 'ideal' | 'assetManagement' | 'purposeOperation' | 'business';
  incomeKind?: string;
  costFunction?: string;
  allowanceKind?: string;
  statementSuffices?: boolean;
  defaultTaxCode?: string;
  inputTaxDeductible?: string;
  countsTowardTurnover?: boolean;
  isAssetSale?: boolean;
  externalAccountNumber?: string | null;
  isActive?: boolean;
}

export async function saveCategoryAction(input: CategoryInput): Promise<ActionState> {
  return guardAction('(shell)/admin/finance/actions.ts#saveCategoryAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    // `isActive` kennt nur `setCategoryActive` — das Update-Schema ist `.strict()`.
    const { id, expectedVersion, isActive, ...fields } = input;
    let result = id ? await updateCategory(deps, ctx, { id, expectedVersion, ...fields }) : await createCategory(deps, ctx, fields);
    if (result.ok && isActive !== undefined && result.value.isActive !== isActive) {
      result = await setCategoryActive(deps, ctx, { id: result.value.id, isActive, expectedVersion: result.value.updatedAt });
    }
    revalidateFinanceAdmin();
    if (!result.ok) return toActionState(result, t);
    return toActionState(result, t, t(id ? 'finance.admin.categories.toast.updated' : 'finance.admin.categories.toast.created'));
  });
}

export async function setCategoryActiveAction(id: string, isActive: boolean, expectedVersion: string): Promise<ActionState> {
  return guardAction('(shell)/admin/finance/actions.ts#setCategoryActiveAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await setCategoryActive(deps, ctx, { id, isActive, expectedVersion });
    revalidateFinanceAdmin();
    return toActionState(result, t);
  });
}

export interface FiscalYearInput {
  startsOn: string;
  endsOn: string;
}

export async function createFirstFiscalYearAction(input: FiscalYearInput): Promise<ActionState> {
  return guardAction('(shell)/admin/finance/actions.ts#createFirstFiscalYearAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await createFirstFiscalYear(deps, ctx, input);
    revalidateFinanceAdmin();
    if (!result.ok) return toActionState(result, t);
    return toActionState(result, t, t('finance.admin.fiscalYears.toast.created'));
  });
}

export async function updateFiscalYearAction(input: { id: string; expectedVersion: string; designation?: string; taxReturnFiledOn?: string | null }): Promise<ActionState> {
  return guardAction('(shell)/admin/finance/actions.ts#updateFiscalYearAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await updateFiscalYear(deps, ctx, input);
    revalidateFinanceAdmin();
    return toActionState(result, t);
  });
}

export async function setDatedValueAction(key: string, validFrom: string, value: number | string): Promise<ActionState> {
  return guardAction('(shell)/admin/finance/actions.ts#setDatedValueAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await setDatedValue(deps, ctx, { key, validFrom, value });
    revalidateFinanceAdmin();
    if (!result.ok) return toActionState(result, t);
    return toActionState(result, t, t('finance.admin.datedValues.toast.set'));
  });
}

export async function removeDatedValueAction(key: string, validFrom: string): Promise<ActionState> {
  return guardAction('(shell)/admin/finance/actions.ts#removeDatedValueAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await removeDatedValue(deps, ctx, { key, validFrom });
    revalidateFinanceAdmin();
    if (!result.ok) return toActionState(result, t);
    return toActionState(result, t, t('finance.admin.datedValues.toast.removed'));
  });
}

export interface PurposeInput {
  id?: string;
  expectedVersion?: string;
  name: string;
  description?: string;
  projectId?: string | null;
  targetCents?: number | null;
  abroad?: boolean;
  carryForwardCents?: number | null;
  carryForwardDate?: string | null;
}

export async function savePurposeAction(input: PurposeInput): Promise<ActionState> {
  return guardAction('(shell)/admin/finance/actions.ts#savePurposeAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const { id, expectedVersion, ...fields } = input;
    const result = id ? await updatePurpose(deps, ctx, { id, expectedVersion, ...fields }) : await createPurpose(deps, ctx, fields);
    revalidateFinanceAdmin();
    if (!result.ok) return toActionState(result, t);
    return toActionState(result, t, t(id ? 'finance.admin.purposes.toast.updated' : 'finance.admin.purposes.toast.created'));
  });
}

export async function setPurposeStateAction(id: string, expectedVersion: string, how: 'fulfilled' | 'dissolved' | 'reopen', reason?: string): Promise<ActionState> {
  return guardAction('(shell)/admin/finance/actions.ts#setPurposeStateAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    // F8b Annahme 7: Wiederöffnen verlangt eine Begründung.
    const result = how === 'fulfilled' ? await fulfillPurpose(deps, ctx, { id, expectedVersion }) : how === 'dissolved' ? await dissolvePurpose(deps, ctx, { id, expectedVersion }) : await reopenPurpose(deps, ctx, { id, expectedVersion, reason });
    revalidateFinanceAdmin();
    return toActionState(result, t);
  });
}

export async function setPurposeActiveAction(id: string, isActive: boolean, expectedVersion: string): Promise<ActionState> {
  return guardAction('(shell)/admin/finance/actions.ts#setPurposeActiveAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await setPurposeActive(deps, ctx, { id, isActive, expectedVersion });
    revalidateFinanceAdmin();
    return toActionState(result, t);
  });
}
