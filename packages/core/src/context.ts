import { newId } from './ids';

export type Channel = 'ui' | 'mcp' | 'system';

export interface CallContext {
  userId: string | null;
  permissions: ReadonlySet<string>;
  channel: Channel;
  apiTokenId: string | null;
  ipAddress: string | null;
  requestId: string;
}

export interface SystemContextOptions {
  requestId?: string;
  permissions?: Iterable<string>;
}

export function systemContext(
  requestIdOrOpts?: string | SystemContextOptions,
): CallContext {
  const requestId = typeof requestIdOrOpts === 'string' ? requestIdOrOpts : (requestIdOrOpts?.requestId ?? newId());
  const permissions =
    typeof requestIdOrOpts === 'object' && requestIdOrOpts?.permissions
      ? new Set(requestIdOrOpts.permissions)
      : new Set<string>();
  return {
    userId: null,
    permissions,
    channel: 'system',
    apiTokenId: null,
    ipAddress: null,
    requestId,
  };
}
