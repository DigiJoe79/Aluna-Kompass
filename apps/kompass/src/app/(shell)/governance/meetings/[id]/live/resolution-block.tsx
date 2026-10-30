'use client';

import type { ResolvedRule } from '@kompass/module-governance';
import type { Majority, ResolutionKind } from '@kompass/module-governance/live';
import type { Ref } from 'react';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { VoteTally, type VoteTallyValue } from '@/components/governance/vote-tally';
import type { ActionState } from '@/lib/actions';

/**
 * Ein Beschluss im Mitlauf (Plan U1 Task 9): die Ergebnis-Karte mit der Rechnung des Punkts; die Ablehnung einer
 * Sendung (etwa `notWriter` nach einer Übernahme) steht über der Karte, nicht still verschluckt.
 */
export function ResolutionBlock(props: {
  id: string;
  kind: ResolutionKind;
  unanimousLabel?: 'adopted' | 'elected' | 'discharged';
  voters: number;
  presentVoting: number;
  allVoting: number;
  excluded: number;
  majority: ResolvedRule<Majority>;
  tie: 'rejected' | 'chairDecides';
  value: VoteTallyValue;
  onChange: (next: VoteTallyValue) => void;
  onCommit: () => void;
  sentences: string[];
  time: string | null;
  readOnly: boolean;
  refusal: ActionState | null;
  unanimousRef?: Ref<HTMLButtonElement>;
}) {
  const { refusal, unanimousLabel = 'adopted', ...rest } = props;
  return (
    <div className="flex flex-col gap-3">
      {refusal ? <RefusalNotice state={refusal} /> : null}
      <VoteTally {...rest} unanimousLabel={unanimousLabel} />
    </div>
  );
}
