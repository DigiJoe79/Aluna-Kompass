import type { ClosingStatus, ClosingStepFacts, ClosingStepKey, ClosingStepView } from '@kompass/module-finance';

/** Die Fakten eines Schritts, eingeengt auf seinen Schlüssel. */
export type FactsOf<K extends ClosingStepKey> = Extract<ClosingStepFacts, { key: K }>;

/**
 * Vertrag eines Schrittkörpers (`steps/<key>.tsx`): der aktive Schritt mit seinen Fakten, der ganze Stand für
 * Jahr und Rechte, `canConfirm` (Recht und beendetes Jahr) und `onConfirm`, der den Bestätigen-Dialog (3b) öffnet.
 */
export interface ClosingStepBody<K extends ClosingStepKey> {
  step: ClosingStepView<FactsOf<K>>;
  status: ClosingStatus;
  canConfirm: boolean;
  onConfirm: () => void;
}

/** `step.facts.key` sagt, welcher Körper passt. */
export function factsAre<K extends ClosingStepKey>(step: ClosingStepView, key: K): step is ClosingStepView<FactsOf<K>> {
  return step.facts.key === key;
}
