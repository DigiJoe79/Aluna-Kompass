import 'server-only';
import { coreMcpTools, createKompassMcpHandler, type KompassMcpHandler } from '@kompass/mcp';
import { getDeps } from './deps';

const holder: { handler: KompassMcpHandler | null } = ((globalThis as unknown as { __kompassMcp?: { handler: KompassMcpHandler | null } }).__kompassMcp ??= { handler: null });

export function getMcpHandler(): KompassMcpHandler {
  holder.handler ??= createKompassMcpHandler(getDeps(), { extraTools: coreMcpTools });
  return holder.handler;
}

export async function resetMcpHandler(): Promise<void> {
  await holder.handler?.close();
  holder.handler = null;
}