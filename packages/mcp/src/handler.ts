import { enabledManifests, moduleMcpTools, newId, resolveApiToken, type CallContext, type Deps, type McpToolDefinition } from '@kompass/core';
import { createMcpHandler, McpServer, type AuthInfo } from '@modelcontextprotocol/server';
import { toCallToolResult } from './result';

export interface KompassMcpHandler {
  fetch(request: Request): Promise<Response>;
  close(): Promise<void>;
}

function requestMeta(request: Request): { ipAddress: string | null; requestId: string } {
  const forwarded = request.headers.get('x-forwarded-for');
  return {
    ipAddress: forwarded ? (forwarded.split(',')[0]?.trim() ?? null) : (request.headers.get('x-real-ip') ?? null),
    requestId: request.headers.get('x-request-id') ?? newId(),
  };
}

function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized: valid API token required' }, id: null }), {
    status: 401,
    headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer realm="kompass-mcp"' },
  });
}

function buildServer(deps: Deps, ctx: CallContext, tools: McpToolDefinition[], version: string): McpServer {
  const server = new McpServer({ name: 'aluna-kompass', version });
  for (const tool of tools) {
    server.registerTool(tool.name, { description: tool.description, inputSchema: tool.inputSchema }, async (args: unknown) => toCallToolResult(await tool.handler(deps, ctx, args)));
  }
  return server;
}

export function createKompassMcpHandler(deps: Deps, opts: { extraTools?: McpToolDefinition[]; version?: string } = {}): KompassMcpHandler {
  const version = opts.version ?? '0.1.0';
  const handler = createMcpHandler(
    (mcpCtx) => {
      const ctx = (mcpCtx.authInfo?.extra as { ctx?: CallContext } | undefined)?.ctx;
      if (!ctx) throw new Error('mcp request without authenticated context');
      const tools = [...(opts.extraTools ?? []), ...enabledManifests(deps).flatMap((m) => [...moduleMcpTools(deps, m)])];
      return buildServer(deps, ctx, tools, version);
    },
    { legacy: 'stateless', onerror: (error) => console.error('[mcp]', error) },
  );
  return {
    async fetch(request) {
      const header = request.headers.get('authorization') ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
      const ctx = token ? resolveApiToken(deps, token, requestMeta(request)) : null;
      if (!ctx || !ctx.userId) return unauthorizedResponse();
      const authInfo: AuthInfo = { token: `${token.slice(0, 12)}…`, clientId: ctx.userId, scopes: [...ctx.permissions], extra: { ctx } };
      return handler.fetch(request, { authInfo });
    },
    close: () => handler.close(),
  };
}
