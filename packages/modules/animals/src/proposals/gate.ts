import { localizedConflict, readSetting, requirePermission, unauthorized, type CallContext, type Deps, type Failure } from '@kompass/core';
import { PROPOSALS_ENABLED_KEY } from '../settings';

/*
 * Nicht im Barrel `proposals/index.ts`: Die Signatur (deps, ctx) hielte der MCP-Paritätswächter für einen Dienst
 * ohne Werkzeug; es ist nur die gemeinsame Prüfung der Quellen-Dienste.
 */
/** Gate der Quellen-Werkzeuge: Recht, angemeldeter Nutzer, Einstellung an. */
export function proposalGate(deps: Deps, ctx: CallContext): Failure | null {
  const denied = requirePermission(ctx, 'animals.propose');
  if (denied) return denied;
  if (!ctx.userId) return unauthorized('invalidCredentials');
  if (readSetting<boolean>(deps, PROPOSALS_ENABLED_KEY) !== true) return localizedConflict('proposalsDisabled', 'errors.animalProposals.proposalsDisabled');
  return null;
}

