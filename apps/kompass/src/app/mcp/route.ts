import { getMcpHandler } from '@/lib/mcp';

export const dynamic = 'force-dynamic';

const handle = (request: Request) => getMcpHandler().fetch(request);

export { handle as GET, handle as POST, handle as DELETE };
