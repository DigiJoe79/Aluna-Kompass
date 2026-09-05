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

export function systemContext(requestId: string = newId()): CallContext {
  return {
    userId: null,
    permissions: new Set(),
    channel: 'system',
    apiTokenId: null,
    ipAddress: null,
    requestId,
  };
}
