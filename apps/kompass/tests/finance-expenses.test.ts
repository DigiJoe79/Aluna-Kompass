import type { ExpenseClaimView } from '@kompass/module-finance';
import { tripAmountCents as moduleTripAmount } from '@kompass/module-finance';
import { describe, expect, it } from 'vitest';
import {
  applySaved,
  approveInput,
  CLAIM_BADGE_TONE,
  claimHistory,
  claimHref,
  claimSentence,
  groupClaims,
  deviceFromUserAgent,
  draftInput,
  emptyExpenseForm,
  emptyPosition,
  formatFileSize,
  formFromClaim,
  rateAt,
  receiptProblem,
  totalCents,
  tripAmountCents,
  tripCalculation,
  type ExpenseForm,
} from '@/lib/finance/expenses';

/**
 * F8a Task 5 — die reinen Helfer des Formulars „Auslage einreichen“ (D1):
 * Gerät aus dem User-Agent, Fahrtrechnung zum Vorzeigen, der Weg vom
 * Formularzustand zum Dienst und zurück, die Ablehnung am PDF-Feld.
 */
const RATES = [
  { validFrom: '2026-01-01', centsPerKm: 30 },
  { validFrom: '2026-06-01', centsPerKm: 35 },
];

describe('deviceFromUserAgent', () => {
  it('tells iPhone and Android apart and knows nothing else', () => {
    expect(deviceFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1')).toBe('ios');
    expect(deviceFromUserAgent('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('ios');
    expect(deviceFromUserAgent('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36')).toBe('android');
    expect(deviceFromUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15')).toBeNull();
    expect(deviceFromUserAgent(null)).toBeNull();
  });
});

describe('trip calculation', () => {
  it('takes the rate valid at the position date and rounds like the service', () => {
    expect(rateAt(RATES, '2026-05-31')).toBe(30);
    expect(rateAt(RATES, '2026-06-01')).toBe(35);
    expect(rateAt(RATES, '2025-12-31')).toBeNull();
    expect(rateAt(RATES, '')).toBeNull();

    // Dieselben Grenzfälle wie der Dienst (Task 1): 84 × 30 = 25,20 €; 1 × 30 = 0,30 €; 33 × 35 = 11,55 €; ein halber Cent rundet auf.
    for (const [km, rate] of [[84, 30], [1, 30], [33, 35], [1, 0.5], [3, 16.5], [1.005, 100]] as const) {
      expect(tripAmountCents(km, rate), `${km} × ${rate}`).toBe(moduleTripAmount(km, rate));
    }
    expect(tripAmountCents(84, 30)).toBe(2520);

    expect(tripCalculation('84', '2026-05-10', RATES)).toEqual({ km: 84, centsPerKm: 30, amountCents: 2520 });
    expect(tripCalculation('33', '2026-06-10', RATES)).toEqual({ km: 33, centsPerKm: 35, amountCents: 1155 });
    expect(tripCalculation('', '2026-06-10', RATES)).toBeNull();
    expect(tripCalculation('12,5', '2026-06-10', RATES)).toBeNull();
    expect(tripCalculation('84', '', RATES)).toBeNull();
  });
});

describe('form state to service and back', () => {
  const form = (): ExpenseForm => ({
    ...emptyExpenseForm('DE66999999991234567890'),
    positions: [
      { ...emptyPosition('a', '2026-08-20'), amountText: '19,99', purpose: ' Futter ', projectId: 'p1' },
      { ...emptyPosition('b', '2026-08-21'), kind: 'trip', tripFrom: 'Musterstadt', tripTo: 'Beispielstadt', tripReason: 'Tierarzt', kmText: '84', amountText: '99,00' },
    ],
  });

  it('turns the form into the draft input: amounts in cents, a trip without its own amount, blanks as null', () => {
    const { input, keys } = draftInput(form());
    expect(keys).toEqual(['a', 'b']);
    expect(input).toEqual({
      iban: 'DE66999999991234567890',
      waiver: false,
      recurring: false,
      positions: [
        { kind: 'receipt', positionDate: '2026-08-20', amountCents: 1999, purpose: 'Futter', projectId: 'p1' },
        { kind: 'trip', positionDate: '2026-08-21', purpose: '', projectId: null, tripFrom: 'Musterstadt', tripTo: 'Beispielstadt', tripReason: 'Tierarzt', tripKm: 84 },
      ],
    });

    const empty = draftInput({ ...emptyExpenseForm(null), positions: [emptyPosition('x', '')] });
    expect(empty.input).toEqual({ iban: null, waiver: false, recurring: false, positions: [{ kind: 'receipt', positionDate: null, amountCents: 0, purpose: '', projectId: null }] });

    // Ein unlesbarer Betrag geht als 0 an den Entwurf (nichts ist Pflicht), das Feld behält den Text.
    expect(draftInput({ ...form(), positions: [{ ...emptyPosition('y', '2026-08-20'), amountText: '12.5' }] }).input.positions[0]).toMatchObject({ amountCents: 0 });
    // Mit Verzicht gibt es nichts zu überweisen — die IBAN bleibt aus dem Entwurf.
    expect(draftInput({ ...form(), waiver: true }).input).toMatchObject({ iban: null, waiver: true });
  });

  it('sends "regular activity" only together with the waiver and brings it back from a saved draft', () => {
    expect(emptyExpenseForm(null).recurring).toBe(false);
    expect(draftInput({ ...form(), waiver: true, recurring: true }).input).toMatchObject({ waiver: true, recurring: true });
    // Ohne Verzicht gibt es keine Verzichtsfrist — das Häkchen geht nicht mit.
    expect(draftInput({ ...form(), waiver: false, recurring: true }).input).toMatchObject({ waiver: false, recurring: false });
    expect(formFromClaim(saved({ waiver: true, recurring: true }))).toMatchObject({ waiver: true, recurring: true });
  });

  it('sends id and version once the draft exists', () => {
    const { input } = draftInput({ ...form(), id: 'claim-1', version: 'v1', positions: [{ ...emptyPosition('a', '2026-08-20'), id: 'pos-1' }] });
    expect(input).toMatchObject({ id: 'claim-1', expectedVersion: 'v1', positions: [{ id: 'pos-1' }] });
  });

  const saved = (over: Partial<ExpenseClaimView> = {}): ExpenseClaimView =>
    ({
      id: 'claim-1',
      version: 'v2',
      iban: 'DE66999999991234567890',
      waiver: false,
      state: 'draft',
      positions: [
        { id: 'pos-a', kind: 'receipt', positionDate: '2026-08-20', amountCents: 1999, purpose: 'Futter', projectId: 'p1', documentId: 'doc-1', documentNumber: 'BEL-2026-0004', tripFrom: null, tripTo: null, tripReason: null, tripKm: null, tripRateCentsPerKm: null },
        { id: 'pos-b', kind: 'trip', positionDate: '2026-08-21', amountCents: 2520, purpose: '', projectId: null, documentId: null, documentNumber: null, tripFrom: 'Musterstadt', tripTo: 'Beispielstadt', tripReason: 'Tierarzt', tripKm: 84, tripRateCentsPerKm: 30 },
      ],
      ...over,
    }) as unknown as ExpenseClaimView;

  it('takes ids, version and receipts from the saved draft by the keys that were sent, and keeps what was typed meanwhile', () => {
    const typedMeanwhile: ExpenseForm = { ...form(), positions: [{ ...form().positions[0]!, purpose: 'Futter und Streu' }, form().positions[1]!, emptyPosition('c', '2026-08-22')] };
    const next = applySaved(typedMeanwhile, ['a', 'b'], saved());
    expect(next.id).toBe('claim-1');
    expect(next.version).toBe('v2');
    expect(next.positions.map((p) => [p.key, p.id ?? null, p.documentNumber])).toEqual([
      ['a', 'pos-a', 'BEL-2026-0004'],
      ['b', 'pos-b', null],
      ['c', null, null],
    ]);
    expect(next.positions[0]!.purpose).toBe('Futter und Streu');

    // Eine Position, die inzwischen entfernt wurde, kommt nicht zurück.
    const removed = applySaved({ ...form(), positions: [form().positions[1]!] }, ['a', 'b'], saved());
    expect(removed.positions.map((p) => [p.key, p.id])).toEqual([['b', 'pos-b']]);
  });

  it('rebuilds the form from a saved draft', () => {
    const rebuilt = formFromClaim(saved());
    expect(rebuilt).toMatchObject({ id: 'claim-1', version: 'v2', iban: 'DE66999999991234567890', waiver: false });
    expect(rebuilt.positions).toMatchObject([
      { id: 'pos-a', kind: 'receipt', positionDate: '2026-08-20', amountText: '19,99', purpose: 'Futter', projectId: 'p1', documentNumber: 'BEL-2026-0004' },
      { id: 'pos-b', kind: 'trip', positionDate: '2026-08-21', kmText: '84', tripFrom: 'Musterstadt', tripTo: 'Beispielstadt', tripReason: 'Tierarzt', amountText: '' },
    ]);
    expect(formFromClaim(saved({ positions: [{ ...saved().positions[0]!, amountCents: 0, positionDate: null }] })).positions[0]).toMatchObject({ amountText: '', positionDate: '' });
    expect(new Set(rebuilt.positions.map((p) => p.key)).size).toBe(2);
  });

  it('sums receipts as typed and trips as calculated', () => {
    expect(totalCents(form(), RATES)).toBe(1999 + 84 * 35);
    expect(totalCents({ ...form(), positions: [{ ...emptyPosition('a', '2026-08-20'), amountText: 'zwölf' }] }, RATES)).toBe(0);
  });
});

describe('receipt field', () => {
  const MB = 1024 * 1024;

  it('refuses a photo and anything that is not a PDF, and a file above the limit of the configuration', () => {
    expect(receiptProblem({ type: 'application/pdf', size: 2 * MB }, 10 * MB)).toBeNull();
    expect(receiptProblem({ type: 'image/jpeg', size: MB }, 10 * MB)).toBe('photo');
    expect(receiptProblem({ type: 'image/heic', size: MB }, 10 * MB)).toBe('photo');
    expect(receiptProblem({ type: 'text/plain', size: 10 }, 10 * MB)).toBe('notPdf');
    expect(receiptProblem({ type: 'application/pdf', size: 10 * MB + 1 }, 10 * MB)).toBe('tooLarge');
    expect(receiptProblem({ type: 'application/pdf', size: 10 * MB }, 10 * MB)).toBeNull();
  });

  it('names sizes the way people read them', () => {
    expect(formatFileSize(312 * 1024)).toBe('312 KB');
    expect(formatFileSize(2.4 * MB)).toBe('2,4 MB');
    expect(formatFileSize(10 * MB)).toBe('10 MB');
    expect(formatFileSize(800)).toBe('1 KB');
  });
});

/**
 * F8a Task 6 — D2 „Eigene Anträge“ und D3 „Freigaben“: Zustandswort und Satz
 * in Alltagssprache, Gruppen Offen/Erledigt, Verlauf, und die Eingabe der
 * Freigabe aus den Entscheidungen am Bildschirm.
 */
describe('own claims (D2)', () => {
  const claim = (over: Partial<ExpenseClaimView>): ExpenseClaimView =>
    ({
      id: 'c1',
      state: 'submitted',
      stateLabelKey: 'submitted',
      createdAt: '2026-09-20T08:00:00.000Z',
      submittedAt: '2026-09-25T19:14:00.000Z',
      approvedAt: null,
      rejectedAt: null,
      rejectNote: null,
      paid: null,
      ...over,
    }) as unknown as ExpenseClaimView;

  it('gives every state its badge tone — rejected is never red', () => {
    expect(CLAIM_BADGE_TONE).toEqual({ draft: 'warning', submitted: 'info', approved: 'success', paid: 'final', rejected: 'neutral' });
  });

  it('says in everyday words what is going on, with the date that matters', () => {
    expect(claimSentence(claim({ state: 'draft', stateLabelKey: 'draft', submittedAt: null }))).toEqual({ key: 'draft', date: '2026-09-20T08:00:00.000Z' });
    expect(claimSentence(claim({}))).toEqual({ key: 'submitted', date: '2026-09-25T19:14:00.000Z' });
    expect(claimSentence(claim({ state: 'approved', stateLabelKey: 'approved', approvedAt: '2026-09-26T10:00:00.000Z' }))).toEqual({ key: 'approved', date: '2026-09-26T10:00:00.000Z' });
    expect(claimSentence(claim({ state: 'approved', stateLabelKey: 'paid', paid: { settledCents: 4099, paidOn: '2026-10-02', state: 'paid' } }))).toEqual({ key: 'paid', date: '2026-10-02' });
    // Abgelehnt: Der Grund ist der Satz.
    expect(claimSentence(claim({ state: 'rejected', stateLabelKey: 'rejected', rejectedAt: '2026-09-26T10:00:00.000Z', rejectNote: 'Beleg ist nicht lesbar.' }))).toEqual({ key: 'rejected', date: '2026-09-26T10:00:00.000Z', note: 'Beleg ist nicht lesbar.' });
  });

  it('groups open (draft, submitted, approved) before done (paid, rejected), keeping the order', () => {
    const items = [claim({ id: 'a', stateLabelKey: 'paid' }), claim({ id: 'b', stateLabelKey: 'draft' }), claim({ id: 'c', stateLabelKey: 'rejected' }), claim({ id: 'd', stateLabelKey: 'approved' }), claim({ id: 'e' })];
    const groups = groupClaims(items);
    expect(groups.open.map((c) => c.id)).toEqual(['b', 'd', 'e']);
    expect(groups.done.map((c) => c.id)).toEqual(['a', 'c']);
  });

  it('opens a draft in the form and everything else in the detail', () => {
    expect(claimHref({ id: 'c1', state: 'draft' })).toBe('/finance/expenses/new?id=c1');
    expect(claimHref({ id: 'c1', state: 'rejected' })).toBe('/finance/expenses/c1');
  });

  it('lists the history in order: created, submitted, then approved and paid — or rejected', () => {
    expect(claimHistory(claim({ state: 'approved', stateLabelKey: 'paid', approvedAt: '2026-09-26T10:00:00.000Z', paid: { settledCents: 4099, paidOn: '2026-10-02', state: 'paid' } }))).toEqual([
      { key: 'created', at: '2026-09-20T08:00:00.000Z' },
      { key: 'submitted', at: '2026-09-25T19:14:00.000Z' },
      { key: 'approved', at: '2026-09-26T10:00:00.000Z' },
      { key: 'paid', at: '2026-10-02' },
    ]);
    expect(claimHistory(claim({ state: 'rejected', stateLabelKey: 'rejected', rejectedAt: '2026-09-26T10:00:00.000Z' })).map((e) => e.key)).toEqual(['created', 'submitted', 'rejected']);
    // Teilweise bezahlt ist noch nicht „überwiesen“.
    expect(claimHistory(claim({ state: 'approved', stateLabelKey: 'approved', approvedAt: '2026-09-26T10:00:00.000Z', paid: { settledCents: 100, paidOn: '2026-10-02', state: 'partly' } })).map((e) => e.key)).toEqual(['created', 'submitted', 'approved']);
  });
});

describe('approval input (D3)', () => {
  const positions = [{ id: 'p1' }, { id: 'p2' }];

  it('sends a category per decided position, "paid from" as null when empty, and leaves undecided positions out for the service to name', () => {
    expect(approveInput({ claimId: 'c1', version: 'v3', positions, decisions: { p1: { categoryId: 'cat-office', purposeId: '' }, p2: { categoryId: 'cat-travel', purposeId: 'pur-1' } } })).toEqual({
      claimId: 'c1',
      expectedVersion: 'v3',
      positions: [
        { positionId: 'p1', categoryId: 'cat-office', purposeId: null },
        { positionId: 'p2', categoryId: 'cat-travel', purposeId: 'pur-1' },
      ],
    });
    expect(approveInput({ claimId: 'c1', version: 'v3', positions, decisions: { p2: { categoryId: 'cat-travel', purposeId: '' } } }).positions).toEqual([{ positionId: 'p2', categoryId: 'cat-travel', purposeId: null }]);
  });

  it('adds the waiver decision only for a waiver claim, with a reason only when one was typed', () => {
    const waiver = { claimAgreedConfirmed: true, declaredOn: '2026-09-25', lateReason: '  ' };
    expect(approveInput({ claimId: 'c1', version: 'v3', positions, decisions: {}, waiver })).toMatchObject({ waiver: { claimAgreedConfirmed: true, declaredOn: '2026-09-25' } });
    expect(approveInput({ claimId: 'c1', version: 'v3', positions, decisions: {}, waiver }).waiver).not.toHaveProperty('lateReason');
    expect(approveInput({ claimId: 'c1', version: 'v3', positions, decisions: {}, waiver: { ...waiver, lateReason: 'Krank gewesen' } }).waiver).toMatchObject({ lateReason: 'Krank gewesen' });
    expect(approveInput({ claimId: 'c1', version: 'v3', positions, decisions: {} })).not.toHaveProperty('waiver');
  });
});
